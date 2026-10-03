-- ROUTE MAP — conflito ao salvar, histórico de versões, lixeira e registro de erros
--
-- 1) projects.revision: sobe a cada alteração de conteúdo. O sistema salva com a condição
--    "revision = a que eu abri"; se outra pessoa salvou antes, nada é gravado e o usuário é avisado.
-- 2) project_versions: antes de cada alteração o banco guarda a versão anterior (últimas 20 por projeto).
-- 3) Lixeira: excluir marca deleted_at; o projeto some da busca, pode ser restaurado e é apagado de vez
--    depois de 30 dias. Só administrador ou o autor (projetista) movem para a lixeira ou restauram.
-- 4) client_errors: erros do navegador dos usuários, visíveis só para o administrador (últimos 90 dias).
--
-- Rode este arquivo inteiro no SQL Editor do Supabase ANTES de publicar a versão que depende dele.
-- Testes: supabase/tests/seguranca.sql e supabase/tests/versoes.sql.

-- ---------------------------------------------------------------
-- Colunas novas em projects
-- ---------------------------------------------------------------

alter table public.projects
  add column if not exists revision integer not null default 1,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users (id) on delete set null;

create index if not exists projects_company_deleted on public.projects (company_id, deleted_at);

-- ---------------------------------------------------------------
-- Histórico de versões
-- ---------------------------------------------------------------

create table if not exists public.project_versions (
  id bigint generated always as identity primary key,
  project_id text not null references public.projects (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  revision integer not null,
  name text,
  data jsonb not null,
  saved_by uuid references auth.users (id) on delete set null,
  saved_at timestamptz not null
);
create index if not exists project_versions_project on public.project_versions (project_id, revision desc);

alter table public.project_versions enable row level security;

drop policy if exists "equipe vê versões" on public.project_versions;
create policy "equipe vê versões" on public.project_versions
  for select to authenticated using (company_id = public.my_company_id());
drop policy if exists "exige 2 etapas quando ativada" on public.project_versions;
create policy "exige 2 etapas quando ativada" on public.project_versions as restrictive for all to authenticated
  using (public.mfa_satisfied()) with check (public.mfa_satisfied());

--Antes de cada alteração: guarda a versão anterior, sobe a revisão e controla a lixeira
create or replace function public.projects_before_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_content_changed boolean := new.data is distinct from old.data
    or new.name is distinct from old.name
    or new.city is distinct from old.city
    or new.neighborhood is distinct from old.neighborhood
    or new.project_type is distinct from old.project_type;
begin
  --Lixeira: só administrador ou o autor (com cargo de edição) movem ou restauram
  if new.deleted_at is distinct from old.deleted_at then
    if auth.uid() is not null and not (
      public.is_company_admin(old.company_id)
      or (old.created_by = auth.uid() and public.can_edit_projects(old.company_id))
    ) then
      raise exception 'Somente quem criou o projeto ou um administrador pode movê-lo para a lixeira ou restaurá-lo.'
        using errcode = '42501';
    end if;
    new.deleted_by := case when new.deleted_at is null then null else auth.uid() end;
  else
    new.deleted_by := old.deleted_by;
  end if;

  if v_content_changed then
    insert into public.project_versions (project_id, company_id, revision, name, data, saved_by, saved_at)
    values (old.id, old.company_id, old.revision, old.name, old.data, old.updated_by, old.updated_at);
    delete from public.project_versions
    where project_id = old.id
      and id not in (
        select id from public.project_versions where project_id = old.id order by revision desc, id desc limit 20
      );
    new.revision := old.revision + 1;
  else
    new.revision := old.revision;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_versioning on public.projects;
create trigger projects_versioning before update on public.projects
  for each row execute function public.projects_before_update();

--Projeto novo sempre começa na revisão 1 e fora da lixeira
create or replace function public.projects_before_insert()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.revision := 1;
  new.deleted_at := null;
  new.deleted_by := null;
  return new;
end;
$$;

drop trigger if exists projects_new_revision on public.projects;
create trigger projects_new_revision before insert on public.projects
  for each row execute function public.projects_before_insert();

--Versões de um projeto, da mais recente para a mais antiga
create or replace function public.list_project_versions(p_project text)
returns table (id bigint, revision integer, name text, saved_at timestamptz, saved_by_name text, markers integer, cables integer)
language sql stable
set search_path = ''
as $$
  select v.id, v.revision, v.name, v.saved_at, nullif(trim(p.full_name), ''),
         coalesce(jsonb_array_length(case when jsonb_typeof(v.data->'markers') = 'array' then v.data->'markers' end), 0),
         coalesce(jsonb_array_length(case when jsonb_typeof(v.data->'cables') = 'array' then v.data->'cables' end), 0)
  from public.project_versions v
  left join public.profiles p on p.id = v.saved_by
  where v.project_id = p_project
  order by v.revision desc, v.id desc;
$$;

--Volta o projeto para uma versão (a atual vira mais uma versão do histórico)
create or replace function public.restore_project_version(p_version bigint)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_version public.project_versions%rowtype;
  v_revision integer;
begin
  select * into v_version from public.project_versions where id = p_version;
  if not found then
    raise exception 'Versão não encontrada.';
  end if;
  update public.projects set data = v_version.data, name = coalesce(v_version.name, name)
  where id = v_version.project_id
  returning revision into v_revision;
  if v_revision is null then
    raise exception 'Seu cargo não permite alterar este projeto.' using errcode = '42501';
  end if;
  return v_revision;
end;
$$;

-- ---------------------------------------------------------------
-- Lixeira
-- ---------------------------------------------------------------

--Projetos na lixeira da empresa (apaga de vez os que passaram de 30 dias)
create or replace function public.list_trash()
returns table (id text, name text, city text, project_type text, deleted_at timestamptz, deleted_by_name text, can_manage boolean)
language plpgsql
security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
begin
  perform public.require_mfa();
  if v_company is null then
    return;
  end if;
  delete from public.projects p
  where p.company_id = v_company and p.deleted_at < now() - interval '30 days';
  return query
  select p.id, p.name, p.city, p.project_type, p.deleted_at, nullif(trim(pr.full_name), ''),
         public.is_company_admin(v_company) or (p.created_by = auth.uid() and public.can_edit_projects(v_company))
  from public.projects p
  left join public.profiles pr on pr.id = p.deleted_by
  where p.company_id = v_company and p.deleted_at is not null
  order by p.deleted_at desc;
end;
$$;

--A busca e os filtros da janela "Abrir projeto" ignoram a lixeira
create or replace function public.search_projects(
  p_term text default null,
  p_type text default null,
  p_city text default null,
  p_sort text default 'recent',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id text,
  name text,
  city text,
  neighborhood text,
  project_type text,
  created_at timestamptz,
  updated_at timestamptz,
  created_by_name text,
  updated_by_name text,
  summary jsonb,
  total_count bigint
)
language sql stable
set search_path = ''
as $$
  with words as (
    select replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') as w
    from unnest(string_to_array(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_term, ''))), ' ')) w
    where w <> ''
  ), filtered as (
    select p.*
    from public.projects p
    where p.company_id = public.my_company_id()
      and p.deleted_at is null
      and (coalesce(p_type, '') = '' or p.project_type = p_type)
      and (coalesce(p_city, '') = '' or p.city = p_city)
      and not exists (select 1 from words where p.search_text not like '%' || words.w || '%')
  )
  select f.id, f.name, f.city, f.neighborhood, f.project_type, f.created_at, f.updated_at,
         nullif(trim(cp.full_name), ''), nullif(trim(up.full_name), ''),
         f.summary, count(*) over ()
  from filtered f
  left join public.profiles cp on cp.id = f.created_by
  left join public.profiles up on up.id = f.updated_by
  order by
    case when p_sort = 'name' then lower(f.name) end asc,
    case when p_sort = 'city' then lower(coalesce(f.city, '')) end asc,
    case when p_sort = 'oldest' then f.updated_at end asc,
    f.updated_at desc,
    f.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.project_facets()
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.projects where company_id = public.my_company_id() and deleted_at is null),
    'trash', (select count(*) from public.projects where company_id = public.my_company_id() and deleted_at is not null),
    'types', coalesce((
      select jsonb_agg(jsonb_build_object('value', project_type, 'count', n) order by n desc, project_type)
      from (select project_type, count(*) n from public.projects
            where company_id = public.my_company_id() and deleted_at is null and coalesce(project_type, '') <> ''
            group by project_type) t
    ), '[]'::jsonb),
    'cities', coalesce((
      select jsonb_agg(jsonb_build_object('value', city, 'count', n) order by city)
      from (select city, count(*) n from public.projects
            where company_id = public.my_company_id() and deleted_at is null and coalesce(trim(city), '') <> ''
            group by city) c
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------
-- Registro de erros do navegador
-- ---------------------------------------------------------------

create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  message text not null check (char_length(message) <= 1000),
  detail text check (char_length(detail) <= 4000),
  page text check (char_length(page) <= 300),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists client_errors_company_created on public.client_errors (company_id, created_at desc);

alter table public.client_errors enable row level security;

drop policy if exists "usuário registra os próprios erros" on public.client_errors;
create policy "usuário registra os próprios erros" on public.client_errors
  for insert to authenticated with check (user_id = auth.uid() and company_id = public.my_company_id());
drop policy if exists "admin vê os erros da empresa" on public.client_errors;
create policy "admin vê os erros da empresa" on public.client_errors
  for select to authenticated using (public.is_company_admin(company_id));
drop policy if exists "admin limpa os erros da empresa" on public.client_errors;
create policy "admin limpa os erros da empresa" on public.client_errors
  for delete to authenticated using (public.is_company_admin(company_id));
drop policy if exists "exige 2 etapas quando ativada" on public.client_errors;
create policy "exige 2 etapas quando ativada" on public.client_errors as restrictive for all to authenticated
  using (public.mfa_satisfied()) with check (public.mfa_satisfied());

--Mantém só os últimos 90 dias
create or replace function public.client_errors_prune()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.client_errors
  where company_id = new.company_id and created_at < now() - interval '90 days';
  return new;
end;
$$;

drop trigger if exists client_errors_prune on public.client_errors;
create trigger client_errors_prune after insert on public.client_errors
  for each row execute function public.client_errors_prune();

revoke execute on function public.list_project_versions(text), public.restore_project_version(bigint), public.list_trash()
  from public, anon;
grant execute on function public.list_project_versions(text), public.restore_project_version(bigint), public.list_trash()
  to authenticated;
