-- Testes das contas criadas pelo administrador (senha provisória, empresa bloqueada, dono do sistema).
-- Rodam depois das migrações (supabase/tests/run.sh). Cada linha: "ok" ou "FALHA".
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- N novo usuário com senha provisória, V veterano, Z administrador da empresa bloqueada, O dono do sistema
insert into auth.users (id, email, email_confirmed_at, encrypted_password) values
  ('00000000-0000-0000-0000-00000c0c00a1', 'novo@contas.com', now(), 'provisoria'),
  ('00000000-0000-0000-0000-00000c0c00a2', 'veterano@contas.com', now(), 'x'),
  ('00000000-0000-0000-0000-00000c0c00a3', 'admin@bloqueada.com', now(), 'x'),
  ('00000000-0000-0000-0000-00000c0c00a4', 'dono@sistema.com', now(), 'x');
insert into public.companies (id, name) values
  ('c7000000-0000-0000-0000-0000000000c7', 'Empresa Contas'), ('c8000000-0000-0000-0000-0000000000c8', 'Empresa Bloqueada');
insert into public.company_members (company_id, user_id, role) values
  ('c7000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-00000c0c00a1', 'projetista'),
  ('c7000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-00000c0c00a2', 'admin'),
  ('c8000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-00000c0c00a3', 'admin');
insert into public.projects (id, company_id, name) values
  ('conta-p1', 'c7000000-0000-0000-0000-0000000000c7', 'Projeto Contas'), ('conta-p2', 'c8000000-0000-0000-0000-0000000000c8', 'Projeto Bloqueada');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-00000c0c00a4');
-- Como faz a função do servidor (chave de serviço): conta nova com senha provisória e empresa bloqueada
update public.profiles set must_change_password = true where id = '00000000-0000-0000-0000-00000c0c00a1';
update public.companies set blocked_at = now(), blocked_reason = 'pagamento' where id = 'c8000000-0000-0000-0000-0000000000c8';

create temp table rc (teste text, ok boolean);
grant all on rc to authenticated;
create function pg_temp.como(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'aal', 'aal1', 'role', 'authenticated')::text, false);
$$;

-- 1) Senha provisória: entra (vê o que falta), mas não acessa os dados nem desliga a troca sozinho
select pg_temp.como('00000000-0000-0000-0000-00000c0c00a1'); set role authenticated;
insert into rc select 'senha provisória: contexto avisa a troca', (public.get_my_context() ->> 'must_change_password')::boolean;
insert into rc select 'senha provisória: não lê projetos', count(*) = 0 from public.projects;
insert into rc select 'senha provisória: não lê configurações da empresa', count(*) = 0 from public.company_settings;
update public.profiles set must_change_password = false, full_name = 'Novo' where id = '00000000-0000-0000-0000-00000c0c00a1';
do $$ begin perform * from public.list_company_members();
  insert into rc values ('senha provisória: não lista a equipe', false);
exception when others then insert into rc values ('senha provisória: não lista a equipe', true); end $$;
reset role;
insert into rc select 'usuário não desliga a troca obrigatória (o nome muda)', must_change_password and full_name = 'Novo'
  from public.profiles where id = '00000000-0000-0000-0000-00000c0c00a1';

-- 2) Trocou a senha (Supabase Auth): conta liberada
update auth.users set encrypted_password = 'senha-nova' where id = '00000000-0000-0000-0000-00000c0c00a1';
insert into rc select 'trocar a senha libera a conta', not must_change_password from public.profiles where id = '00000000-0000-0000-0000-00000c0c00a1';
select pg_temp.como('00000000-0000-0000-0000-00000c0c00a1'); set role authenticated;
insert into rc select 'depois da troca lê os projetos da empresa', count(*) = 1 from public.projects;
reset role;

-- 3) Empresa bloqueada: o administrador entra, vê o bloqueio, não acessa os dados nem se desbloqueia
select pg_temp.como('00000000-0000-0000-0000-00000c0c00a3'); set role authenticated;
insert into rc select 'empresa bloqueada: contexto avisa', (public.get_my_context() -> 'company' ->> 'blocked')::boolean;
insert into rc select 'empresa bloqueada: não lê projetos', count(*) = 0 from public.projects;
update public.companies set blocked_at = null, blocked_reason = null, name = 'Bloqueada S.A.' where id = 'c8000000-0000-0000-0000-0000000000c8';
reset role;
insert into rc select 'administrador não desbloqueia a própria empresa (o nome muda)', blocked_at is not null and name = 'Bloqueada S.A.'
  from public.companies where id = 'c8000000-0000-0000-0000-0000000000c8';

-- 4) Sem cadastro aberto de empresa; dono do sistema reconhecido
select pg_temp.como('00000000-0000-0000-0000-00000c0c00a4'); set role authenticated;
do $$ begin perform public.create_company('Empresa Pirata');
  insert into rc values ('ninguém cria empresa pela API', false);
exception when others then insert into rc values ('ninguém cria empresa pela API', true); end $$;
insert into rc select 'dono do sistema reconhecido', public.is_platform_admin() and (public.get_my_context() ->> 'platform_admin')::boolean;
insert into rc select 'tabela de donos não é lida pela API', count(*) = 0 from public.platform_admins;
reset role;
select pg_temp.como('00000000-0000-0000-0000-00000c0c00a2'); set role authenticated;
insert into rc select 'administrador comum não é dono do sistema', not public.is_platform_admin();
insert into rc select 'conta veterana continua acessando', count(*) = 1 from public.projects;
reset role;
insert into rc select 'ninguém virou empresa nova', count(*) = 0 from public.companies where name = 'Empresa Pirata';

select case when ok then 'ok   ' else 'FALHA' end || '  ' || teste from rc;
do $$ begin if exists (select 1 from rc where not ok) then raise exception '% teste(s) de contas falharam', (select count(*) from rc where not ok); end if; end $$;
