-- ROUTE MAP — cargos e presença online
--
-- Cargos:
--   admin      Administrador: controla tudo (equipe, convites, empresa, preços/kits/configurações)
--                            e vê quem está online.
--   projetista Projetista:    cria, edita e salva projetos; não acessa a parte administrativa.
--   member     Membro:        somente visualiza (abre projetos, sem editar nem salvar).
--
-- Rode este arquivo inteiro no SQL Editor do Supabase (projeto GeoVini) ANTES de publicar
-- a versão do sistema que usa os três cargos.

-- ---------------------------------------------------------------
-- Cargos
-- ---------------------------------------------------------------

alter table public.company_members drop constraint if exists company_members_role_check;
alter table public.company_invites drop constraint if exists company_invites_role_check;

-- Até aqui "member" editava projetos: quem já era membro vira projetista para não perder acesso.
-- (Só o administrador pode rebaixar alguém para "Membro" depois.)
update public.company_members set role = 'projetista' where role = 'member';
update public.company_invites set role = 'projetista' where role = 'member' and accepted_at is null;

alter table public.company_members
  add constraint company_members_role_check check (role in ('admin', 'projetista', 'member'));
alter table public.company_invites
  add constraint company_invites_role_check check (role in ('admin', 'projetista', 'member'));

create or replace function public.can_edit_projects(p_company uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.company_members
    where company_id = p_company and user_id = auth.uid() and role in ('admin', 'projetista')
  );
$$;

-- ---------------------------------------------------------------
-- Projetos: só administrador e projetista gravam
-- ---------------------------------------------------------------

drop policy if exists "equipe cria projetos" on public.projects;
drop policy if exists "equipe edita projetos" on public.projects;
drop policy if exists "autor ou admin exclui projetos" on public.projects;
drop policy if exists "projetistas criam projetos" on public.projects;
drop policy if exists "projetistas editam projetos" on public.projects;
drop policy if exists "admin ou autor exclui projetos" on public.projects;

create policy "projetistas criam projetos" on public.projects
  for insert to authenticated with check (
    company_id = public.my_company_id() and created_by = auth.uid() and public.can_edit_projects(company_id)
  );
create policy "projetistas editam projetos" on public.projects
  for update to authenticated
  using (company_id = public.my_company_id() and public.can_edit_projects(company_id))
  with check (company_id = public.my_company_id() and public.can_edit_projects(company_id));
create policy "admin ou autor exclui projetos" on public.projects
  for delete to authenticated using (
    company_id = public.my_company_id()
    and (public.is_company_admin(company_id) or (created_by = auth.uid() and public.can_edit_projects(company_id)))
  );

-- ---------------------------------------------------------------
-- Alterar cargo (apenas administrador; a empresa nunca fica sem administrador)
-- ---------------------------------------------------------------

create or replace function public.set_member_role(p_user uuid, p_role text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
begin
  if not public.is_company_admin(v_company) then
    raise exception 'Apenas administradores podem alterar cargos.';
  end if;
  if p_role not in ('admin', 'projetista', 'member') then
    raise exception 'Cargo inválido.';
  end if;
  if p_role <> 'admin' and (
    select count(*) from public.company_members where company_id = v_company and role = 'admin' and user_id <> p_user
  ) = 0 then
    raise exception 'A empresa precisa ter pelo menos um administrador.';
  end if;
  update public.company_members set role = p_role where company_id = v_company and user_id = p_user;
end;
$$;

-- ---------------------------------------------------------------
-- Presença online (o administrador vê quem está conectado)
-- ---------------------------------------------------------------

-- Sem políticas de propósito: ninguém lê nem grava direto; o acesso é só pelas funções abaixo.
create table if not exists public.member_presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  signed_out_at timestamptz,
  project_name text
);
alter table public.member_presence enable row level security;

-- O sistema chama a cada ~45 s enquanto a página está aberta
create or replace function public.heartbeat(p_project text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
begin
  if auth.uid() is null or v_company is null then
    return;
  end if;
  insert into public.member_presence (user_id, company_id, last_seen_at, project_name)
  values (auth.uid(), v_company, now(), nullif(left(trim(coalesce(p_project, '')), 120), ''))
  on conflict (user_id) do update
    set company_id = excluded.company_id,
        last_seen_at = now(),
        project_name = excluded.project_name;
end;
$$;

-- Chamado ao sair do sistema ou fechar a página
create or replace function public.go_offline()
returns void
language sql security definer set search_path = ''
as $$
  update public.member_presence set signed_out_at = now(), project_name = null where user_id = auth.uid();
$$;

-- Equipe com cargo, e-mail e (somente para o administrador) presença online
drop function if exists public.list_company_members();
create function public.list_company_members()
returns table (
  user_id uuid, email text, full_name text, job_title text, role text, joined_at timestamptz,
  last_seen_at timestamptz, is_online boolean, active_project text
)
language sql stable security definer set search_path = ''
as $$
  with me as (
    select public.my_company_id() as company_id,
           public.is_company_admin(public.my_company_id()) as is_admin
  ), base as (
    select m.user_id, u.email::text as email, p.full_name, p.job_title, m.role, m.created_at as joined_at,
           pr.last_seen_at, pr.project_name,
           coalesce(
             pr.last_seen_at > now() - interval '100 seconds'
             and (pr.signed_out_at is null or pr.signed_out_at < pr.last_seen_at),
             false
           ) as online
    from public.company_members m
    join me on me.company_id = m.company_id
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
    left join public.member_presence pr on pr.user_id = m.user_id
  )
  select b.user_id, b.email, b.full_name, b.job_title, b.role, b.joined_at,
         case when me.is_admin then b.last_seen_at end,
         case when me.is_admin then b.online end,
         case when me.is_admin and b.online then b.project_name end
  from base b cross join me
  order by array_position(array['admin', 'projetista', 'member'], b.role), coalesce(b.full_name, b.email);
$$;

revoke execute on function public.can_edit_projects(uuid), public.set_member_role(uuid, text),
  public.heartbeat(text), public.go_offline(), public.list_company_members()
  from public, anon;
grant execute on function public.can_edit_projects(uuid), public.set_member_role(uuid, text),
  public.heartbeat(text), public.go_offline(), public.list_company_members()
  to authenticated;
