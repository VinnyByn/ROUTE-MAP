-- ROUTE MAP — estrutura multiempresa
-- Cada usuário pertence a uma empresa. Projetos são compartilhados pela equipe.
-- Preços, kits e configurações são por empresa e só o admin pode alterá-los.

-- ---------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  document text,                -- CNPJ (opcional)
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
-- Um usuário participa de uma única empresa
create unique index company_members_one_company_per_user on public.company_members (user_id);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  job_title text,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  role text not null default 'member' check (role in ('admin', 'member')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index company_invites_pending_email
  on public.company_invites (company_id, lower(email)) where accepted_at is null;

-- Catálogo de materiais/kits e configurações de cálculo da empresa
create table public.company_settings (
  company_id uuid primary key references public.companies (id) on delete cascade,
  material_catalog jsonb,       -- { materials: [...], kits: [...] }
  lancamento_config jsonb,      -- vão entre postes, ferragens por poste
  labor_config jsonb,           -- custo/hora, horas/dia, produtividade
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.projects (
  id text primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  city text,
  neighborhood text,
  project_type text,
  data jsonb not null default '{}'::jsonb,  -- sidebar, markers, cables, polygons, bom, observations
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_company_updated on public.projects (company_id, updated_at desc);

-- ---------------------------------------------------------------
-- Funções auxiliares (security definer evita recursão nas políticas)
-- ---------------------------------------------------------------

create or replace function public.my_company_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select company_id from public.company_members where user_id = auth.uid() limit 1;
$$;

create or replace function public.is_company_admin(p_company uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.company_members
    where company_id = p_company and user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.touch_row()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_table_name in ('projects', 'company_settings') then
    new.updated_by := auth.uid();
  end if;
  --Autor e data de criação não mudam depois de criados
  if tg_table_name = 'projects' and tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger companies_touch before update on public.companies
  for each row execute function public.touch_row();
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_row();
create trigger company_settings_touch before insert or update on public.company_settings
  for each row execute function public.touch_row();
create trigger projects_touch before insert or update on public.projects
  for each row execute function public.touch_row();

-- Perfil criado automaticamente no cadastro
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------
-- Segurança em nível de linha
-- ---------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.profiles enable row level security;
alter table public.company_invites enable row level security;
alter table public.company_settings enable row level security;
alter table public.projects enable row level security;

create policy "membros veem a empresa" on public.companies
  for select to authenticated using (id = public.my_company_id());
create policy "admin edita a empresa" on public.companies
  for update to authenticated using (public.is_company_admin(id)) with check (public.is_company_admin(id));

create policy "membros veem a equipe" on public.company_members
  for select to authenticated using (company_id = public.my_company_id());

create policy "ver o próprio perfil e o da equipe" on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or id in (select user_id from public.company_members where company_id = public.my_company_id())
  );
create policy "criar o próprio perfil" on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy "editar o próprio perfil" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "admin vê convites" on public.company_invites
  for select to authenticated using (public.is_company_admin(company_id));
create policy "admin cria convites" on public.company_invites
  for insert to authenticated with check (public.is_company_admin(company_id) and invited_by = auth.uid());
create policy "admin remove convites" on public.company_invites
  for delete to authenticated using (public.is_company_admin(company_id));

create policy "membros leem configurações" on public.company_settings
  for select to authenticated using (company_id = public.my_company_id());
create policy "admin cria configurações" on public.company_settings
  for insert to authenticated with check (public.is_company_admin(company_id));
create policy "admin altera configurações" on public.company_settings
  for update to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

create policy "equipe lê projetos" on public.projects
  for select to authenticated using (company_id = public.my_company_id());
create policy "equipe cria projetos" on public.projects
  for insert to authenticated with check (company_id = public.my_company_id() and created_by = auth.uid());
create policy "equipe edita projetos" on public.projects
  for update to authenticated using (company_id = public.my_company_id()) with check (company_id = public.my_company_id());
create policy "autor ou admin exclui projetos" on public.projects
  for delete to authenticated using (
    company_id = public.my_company_id() and (created_by = auth.uid() or public.is_company_admin(company_id))
  );

-- ---------------------------------------------------------------
-- Operações (RPC)
-- ---------------------------------------------------------------

-- Contexto do usuário logado: empresa, papel, perfil e convite pendente
create or replace function public.get_my_context()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'não autenticado';
  end if;
  select email into v_email from auth.users where id = v_uid;
  select jsonb_build_object(
    'user_id', v_uid,
    'email', v_email,
    'profile', (select to_jsonb(p) - 'id' from public.profiles p where p.id = v_uid),
    'company', (
      select jsonb_build_object('id', c.id, 'name', c.name, 'document', c.document, 'role', m.role)
      from public.company_members m join public.companies c on c.id = m.company_id
      where m.user_id = v_uid
    ),
    'pending_invite', (
      select jsonb_build_object('id', i.id, 'company_name', c.name, 'role', i.role)
      from public.company_invites i join public.companies c on c.id = i.company_id
      where lower(i.email) = lower(v_email) and i.accepted_at is null
      order by i.created_at desc limit 1
    )
  ) into v_result;
  return v_result;
end;
$$;

-- Cria uma empresa e torna o usuário administrador
create or replace function public.create_company(p_name text, p_document text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  if exists (select 1 from public.company_members where user_id = auth.uid()) then
    raise exception 'Você já faz parte de uma empresa.';
  end if;
  insert into public.companies (name, document, created_by)
  values (trim(p_name), nullif(trim(coalesce(p_document, '')), ''), auth.uid())
  returning id into v_company;
  insert into public.company_members (company_id, user_id, role) values (v_company, auth.uid(), 'admin');
  insert into public.company_settings (company_id) values (v_company);
  return v_company;
end;
$$;

-- Aceita o convite pendente enviado para o e-mail do usuário
create or replace function public.accept_pending_invite()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text;
  v_invite public.company_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  if exists (select 1 from public.company_members where user_id = auth.uid()) then
    raise exception 'Você já faz parte de uma empresa.';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  select * into v_invite from public.company_invites
  where lower(email) = lower(v_email) and accepted_at is null
  order by created_at desc limit 1;
  if not found then
    return null;
  end if;
  insert into public.company_members (company_id, user_id, role)
  values (v_invite.company_id, auth.uid(), v_invite.role);
  update public.company_invites set accepted_at = now() where id = v_invite.id;
  return v_invite.company_id;
end;
$$;

-- Equipe da empresa com e-mail (auth.users não é acessível pelo cliente)
create or replace function public.list_company_members()
returns table (user_id uuid, email text, full_name text, job_title text, role text, joined_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select m.user_id, u.email::text, p.full_name, p.job_title, m.role, m.created_at
  from public.company_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.company_id = public.my_company_id()
  order by m.role, coalesce(p.full_name, u.email);
$$;

create or replace function public.set_member_role(p_user uuid, p_role text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
begin
  if not public.is_company_admin(v_company) then
    raise exception 'Apenas administradores podem alterar papéis.';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'Papel inválido.';
  end if;
  if p_role = 'member' and (
    select count(*) from public.company_members where company_id = v_company and role = 'admin' and user_id <> p_user
  ) = 0 then
    raise exception 'A empresa precisa ter pelo menos um administrador.';
  end if;
  update public.company_members set role = p_role where company_id = v_company and user_id = p_user;
end;
$$;

create or replace function public.remove_member(p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
begin
  if p_user <> auth.uid() and not public.is_company_admin(v_company) then
    raise exception 'Apenas administradores podem remover membros.';
  end if;
  if (
    select count(*) from public.company_members where company_id = v_company and role = 'admin' and user_id <> p_user
  ) = 0 then
    raise exception 'A empresa precisa ter pelo menos um administrador.';
  end if;
  delete from public.company_members where company_id = v_company and user_id = p_user;
end;
$$;

revoke execute on function public.get_my_context(), public.create_company(text, text), public.accept_pending_invite(),
  public.list_company_members(), public.set_member_role(uuid, text), public.remove_member(uuid),
  public.my_company_id(), public.is_company_admin(uuid)
  from public, anon;
grant execute on function public.get_my_context(), public.create_company(text, text), public.accept_pending_invite(),
  public.list_company_members(), public.set_member_role(uuid, text), public.remove_member(uuid),
  public.my_company_id(), public.is_company_admin(uuid)
  to authenticated;
