-- ROUTE MAP — reforço de segurança
--
-- 1) Verificação em duas etapas valendo no banco: quem ativou o aplicativo autenticador só acessa
--    dados com uma sessão que passou pelo código (aal2). Antes a exigência existia só na tela, e uma
--    senha roubada dava acesso direto pela API.
-- 2) Convites só podem ser vistos e aceitos por conta com e-mail confirmado (evita alguém criar
--    conta com o e-mail convidado de outra pessoa e entrar na empresa no lugar dela).
--
-- Rode este arquivo inteiro no SQL Editor do Supabase ANTES de publicar a versão que depende dele.
-- Testes: supabase/tests/seguranca.sql (rodam no GitHub Actions num Postgres local).

-- ---------------------------------------------------------------
-- Verificação em duas etapas
-- ---------------------------------------------------------------

--Verdadeiro quando o usuário não tem autenticador ativo, ou quando a sessão atual passou pelo código
create or replace function public.mfa_satisfied()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors
        where user_id = auth.uid() and status = 'verified'
      );
$$;

create or replace function public.require_mfa()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.mfa_satisfied() then
    raise exception 'Digite o código do aplicativo autenticador para continuar.'
      using errcode = '42501';
  end if;
end;
$$;

--Políticas restritivas: somam-se (com E) às políticas que já existem em cada tabela
do $$
declare
  t text;
begin
  foreach t in array array['companies', 'company_members', 'profiles', 'company_invites', 'company_settings', 'projects']
  loop
    execute format('drop policy if exists "exige 2 etapas quando ativada" on public.%I', t);
    execute format(
      'create policy "exige 2 etapas quando ativada" on public.%I as restrictive for all to authenticated
         using (public.mfa_satisfied()) with check (public.mfa_satisfied())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------
-- Funções (RPC): mesma exigência + convites só com e-mail confirmado
-- ---------------------------------------------------------------

create or replace function public.get_my_context()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed boolean;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'não autenticado';
  end if;
  perform public.require_mfa();
  select email, email_confirmed_at is not null into v_email, v_confirmed from auth.users where id = v_uid;
  select jsonb_build_object(
    'user_id', v_uid,
    'email', v_email,
    'profile', (select to_jsonb(p) - 'id' from public.profiles p where p.id = v_uid),
    'company', (
      select jsonb_build_object('id', c.id, 'name', c.name, 'document', c.document, 'role', m.role)
      from public.company_members m join public.companies c on c.id = m.company_id
      where m.user_id = v_uid
    ),
    'pending_invite', case when v_confirmed then (
      select jsonb_build_object('id', i.id, 'company_name', c.name, 'role', i.role)
      from public.company_invites i join public.companies c on c.id = i.company_id
      where lower(i.email) = lower(v_email) and i.accepted_at is null
      order by i.created_at desc limit 1
    ) end
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.accept_pending_invite()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text;
  v_confirmed boolean;
  v_invite public.company_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  perform public.require_mfa();
  if exists (select 1 from public.company_members where user_id = auth.uid()) then
    raise exception 'Você já faz parte de uma empresa.';
  end if;
  select email, email_confirmed_at is not null into v_email, v_confirmed from auth.users where id = auth.uid();
  if not v_confirmed then
    raise exception 'Confirme seu e-mail antes de aceitar o convite.';
  end if;
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
  perform public.require_mfa();
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

create or replace function public.set_member_role(p_user uuid, p_role text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
begin
  perform public.require_mfa();
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

create or replace function public.remove_member(p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
begin
  perform public.require_mfa();
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

--Lista da equipe: corpo igual ao da migração de cargos, com a exigência de 2 etapas
create or replace function public.list_company_members()
returns table (
  user_id uuid, email text, full_name text, job_title text, role text, joined_at timestamptz,
  last_seen_at timestamptz, is_online boolean, active_project text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_mfa();
  return query
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
end;
$$;

create or replace function public.heartbeat(p_project text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
begin
  if auth.uid() is null or v_company is null or not public.mfa_satisfied() then
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

revoke execute on function public.mfa_satisfied(), public.require_mfa() from public, anon;
grant execute on function public.mfa_satisfied(), public.require_mfa() to authenticated;
revoke execute on function public.get_my_context(), public.accept_pending_invite(), public.create_company(text, text),
  public.set_member_role(uuid, text), public.remove_member(uuid), public.list_company_members(), public.heartbeat(text)
  from public, anon;
grant execute on function public.get_my_context(), public.accept_pending_invite(), public.create_company(text, text),
  public.set_member_role(uuid, text), public.remove_member(uuid), public.list_company_members(), public.heartbeat(text)
  to authenticated;
