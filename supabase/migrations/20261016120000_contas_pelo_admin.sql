-- ROUTE MAP — contas criadas pelo administrador e pelo dono do sistema
--
-- 1) Sem cadastro aberto: empresas novas são criadas pelo dono do sistema (painel do sistema), já com o
--    administrador; o administrador cria os usuários da equipe. Quem cria a conta define uma senha
--    provisória, e a pessoa troca por uma senha só dela no primeiro acesso (profiles.must_change_password).
--    Enquanto não troca, não acessa os dados. O próprio usuário não consegue desligar a troca obrigatória.
-- 2) Dono do sistema (public.platform_admins): vê todas as empresas, cria empresa + administrador,
--    bloqueia/reativa e redefine senhas. As operações com senha rodam na função do servidor
--    supabase/functions/admin-users (chave de serviço), nunca no navegador.
-- 3) Empresa bloqueada (companies.blocked_at): a equipe entra, mas não acessa os dados até ser reativada.
--    O administrador da empresa não consegue se desbloquear.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase ANTES de publicar a versão que depende dele.
-- Depois, marque a sua conta como dono do sistema (troque pelo seu e-mail):
--   insert into public.platform_admins (user_id) select id from auth.users where email = 'seu@email.com';
-- E desligue o cadastro aberto: Authentication › Sign In / Providers › "Allow new users to sign up".
-- Testes: supabase/tests/contas.sql (rodam no GitHub Actions num Postgres local).

-- ---------------------------------------------------------------
-- Estrutura
-- ---------------------------------------------------------------

alter table public.profiles add column if not exists must_change_password boolean not null default false;
alter table public.companies add column if not exists blocked_at timestamptz;
alter table public.companies add column if not exists blocked_reason text;

-- Dono(s) do sistema: sem políticas de propósito (ninguém lê nem grava pela API; só as funções abaixo)
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- Conta liberada: senha provisória já trocada e empresa não bloqueada
create or replace function public.account_active()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not coalesce((select must_change_password from public.profiles where id = auth.uid()), false)
     and not exists (
       select 1 from public.company_members m join public.companies c on c.id = m.company_id
       where m.user_id = auth.uid() and c.blocked_at is not null
     );
$$;

-- ---------------------------------------------------------------
-- Travas: o usuário não desliga a troca de senha nem desbloqueia a empresa
-- (só o servidor, com a chave de serviço, ou as funções do banco)
-- ---------------------------------------------------------------

create or replace function public.profiles_guard_password_flag()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.must_change_password := false;
    elsif new.must_change_password is distinct from old.must_change_password then
      new.must_change_password := old.must_change_password;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_password_flag on public.profiles;
create trigger profiles_guard_password_flag before insert or update on public.profiles
  for each row execute function public.profiles_guard_password_flag();

create or replace function public.companies_guard_block()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.blocked_at := old.blocked_at;
    new.blocked_reason := old.blocked_reason;
  end if;
  return new;
end;
$$;

drop trigger if exists companies_guard_block on public.companies;
create trigger companies_guard_block before update on public.companies
  for each row execute function public.companies_guard_block();

-- Troca de senha (pelo próprio usuário no Supabase Auth) libera a conta
create or replace function public.handle_password_changed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.profiles set must_change_password = false where id = new.id and must_change_password;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_password_changed on auth.users;
create trigger on_auth_user_password_changed
  after update of encrypted_password on auth.users
  for each row execute function public.handle_password_changed();

-- ---------------------------------------------------------------
-- Acesso aos dados só com a conta liberada
-- ---------------------------------------------------------------

-- As funções que já exigiam as 2 etapas passam a exigir também a conta liberada
create or replace function public.require_mfa()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.mfa_satisfied() then
    raise exception 'Digite o código do aplicativo autenticador para continuar.'
      using errcode = '42501';
  end if;
  if coalesce((select must_change_password from public.profiles where id = auth.uid()), false) then
    raise exception 'Troque a senha provisória para continuar.' using errcode = '42501';
  end if;
  if not public.account_active() then
    raise exception 'O acesso da empresa está suspenso. Fale com o fornecedor do sistema.' using errcode = '42501';
  end if;
end;
$$;

-- Políticas restritivas (somam-se com E às que já existem) nas tabelas de dados da empresa.
-- Empresa, equipe e perfil continuam legíveis: a tela de login precisa deles para mostrar o que falta.
do $$
declare
  t text;
begin
  foreach t in array array['projects', 'project_versions', 'company_settings', 'box_templates', 'company_invites']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "conta liberada" on public.%I', t);
      execute format(
        'create policy "conta liberada" on public.%I as restrictive for all to authenticated
           using (public.account_active()) with check (public.account_active())', t);
    end if;
  end loop;
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists "conta liberada" on realtime.messages';
    execute 'create policy "conta liberada" on realtime.messages as restrictive for all to authenticated
               using (public.account_active()) with check (public.account_active())';
  end if;
end $$;

-- ---------------------------------------------------------------
-- Contexto do usuário: + empresa bloqueada, troca de senha pendente e dono do sistema
-- (não exige a conta liberada: é ele que diz à tela o que falta)
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
  if not public.mfa_satisfied() then
    raise exception 'Digite o código do aplicativo autenticador para continuar.' using errcode = '42501';
  end if;
  select email, email_confirmed_at is not null into v_email, v_confirmed from auth.users where id = v_uid;
  select jsonb_build_object(
    'user_id', v_uid,
    'email', v_email,
    'profile', (select to_jsonb(p) - 'id' from public.profiles p where p.id = v_uid),
    'must_change_password', coalesce((select must_change_password from public.profiles where id = v_uid), false),
    'platform_admin', public.is_platform_admin(),
    'company', (
      select jsonb_build_object('id', c.id, 'name', c.name, 'document', c.document, 'role', m.role,
                                'blocked', c.blocked_at is not null, 'blocked_reason', c.blocked_reason)
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

-- Sem cadastro aberto de empresas: quem cria é o dono do sistema (painel do sistema)
create or replace function public.create_company(p_name text, p_document text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'Empresas novas são criadas pelo fornecedor do sistema.' using errcode = '42501';
end;
$$;

revoke execute on function public.is_platform_admin(), public.account_active() from public, anon;
grant execute on function public.is_platform_admin(), public.account_active() to authenticated;
revoke execute on function public.get_my_context(), public.create_company(text, text) from public, anon;
grant execute on function public.get_my_context(), public.create_company(text, text) to authenticated;
