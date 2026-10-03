-- Testes de segurança das regras do banco (RLS e funções).
-- Rodam num Postgres local com a imitação do Supabase (supabase/tests/supabase-shim.sql) depois das migrações.
-- Cada linha do resultado é "ok" ou "FALHA: ..."; o script termina com erro se houver falha.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- Usuários: A admin com 2 etapas, B projetista, C membro, D admin de outra empresa,
-- E convidado com e-mail confirmado, X conta não confirmada com o e-mail de outro convite
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-00000000000a', 'a@empresa1.com', now()),
  ('00000000-0000-0000-0000-00000000000b', 'b@empresa1.com', now()),
  ('00000000-0000-0000-0000-00000000000c', 'c@empresa1.com', now()),
  ('00000000-0000-0000-0000-00000000000d', 'd@empresa2.com', now()),
  ('00000000-0000-0000-0000-00000000000e', 'e@novo.com', now()),
  ('00000000-0000-0000-0000-0000000000ff', 'vitima@novo.com', null);
insert into auth.mfa_factors (user_id, status) values ('00000000-0000-0000-0000-00000000000a', 'verified');
insert into public.companies (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'Empresa 1'), ('20000000-0000-0000-0000-000000000002', 'Empresa 2');
insert into public.company_members (company_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'admin'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'projetista'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'member'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000d', 'admin');
insert into public.company_settings (company_id) values ('10000000-0000-0000-0000-000000000001'), ('20000000-0000-0000-0000-000000000002');
insert into public.projects (id, company_id, name) values ('p1', '10000000-0000-0000-0000-000000000001', 'Projeto 1'), ('p2', '20000000-0000-0000-0000-000000000002', 'Projeto 2');
insert into public.company_invites (company_id, email, role) values
  ('10000000-0000-0000-0000-000000000001', 'vitima@novo.com', 'projetista'),
  ('10000000-0000-0000-0000-000000000001', 'e@novo.com', 'member');

create temp table resultado (teste text, ok boolean);
grant all on resultado to authenticated;

create function pg_temp.como(p_user text, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'aal', p_aal, 'role', 'authenticated')::text, false);
$$;

-- 1) Senha roubada de quem tem 2 etapas (sessão aal1) não acessa dados
select pg_temp.como('00000000-0000-0000-0000-00000000000a', 'aal1'); set role authenticated;
insert into resultado select 'admin com 2 etapas e sessão só com senha não lê projetos', count(*) = 0 from public.projects;
insert into resultado select 'admin com 2 etapas e sessão só com senha não lê configurações', count(*) = 0 from public.company_settings;
update public.projects set name = 'alterado' where id = 'p1';
reset role;
insert into resultado select 'admin com 2 etapas e sessão só com senha não altera projeto', name = 'Projeto 1' from public.projects where id = 'p1';
set role authenticated;
do $$ begin perform public.set_member_role('00000000-0000-0000-0000-00000000000c', 'admin');
  insert into resultado values ('admin com 2 etapas e sessão só com senha não troca cargos', false);
exception when others then insert into resultado values ('admin com 2 etapas e sessão só com senha não troca cargos', true); end $$;
do $$ begin perform * from public.list_company_members();
  insert into resultado values ('admin com 2 etapas e sessão só com senha não lista a equipe', false);
exception when others then insert into resultado values ('admin com 2 etapas e sessão só com senha não lista a equipe', true); end $$;
reset role;

-- 2) Com o código (aal2) tudo funciona
select pg_temp.como('00000000-0000-0000-0000-00000000000a', 'aal2'); set role authenticated;
insert into resultado select 'admin com 2 etapas e código lê projetos da empresa', count(*) = 1 from public.projects;
insert into resultado select 'admin com 2 etapas e código lista a equipe', count(*) = 3 from public.list_company_members();
reset role;

-- 3) Quem não ativou 2 etapas continua entrando só com a senha
select pg_temp.como('00000000-0000-0000-0000-00000000000b', 'aal1'); set role authenticated;
insert into resultado select 'projetista sem 2 etapas lê projetos', count(*) = 1 from public.projects;
update public.projects set name = 'Projeto 1 (editado)' where id = 'p1';
reset role;
insert into resultado select 'projetista edita projeto', name = 'Projeto 1 (editado)' from public.projects where id = 'p1';

-- 4) Membro (somente visualização) não grava nem pela API
select pg_temp.como('00000000-0000-0000-0000-00000000000c', 'aal1'); set role authenticated;
update public.projects set name = 'hack' where id = 'p1';
do $$ begin insert into public.projects (id, company_id, name, created_by) values ('px', '10000000-0000-0000-0000-000000000001', 'x', '00000000-0000-0000-0000-00000000000c');
  insert into resultado values ('membro não cria projeto', false);
exception when others then insert into resultado values ('membro não cria projeto', true); end $$;
delete from public.projects where id = 'p1';
reset role;
insert into resultado select 'membro não altera nem exclui projeto', name = 'Projeto 1 (editado)' from public.projects where id = 'p1';

-- 5) Uma empresa não vê nem altera a outra
select pg_temp.como('00000000-0000-0000-0000-00000000000d', 'aal1'); set role authenticated;
insert into resultado select 'outra empresa não vê os projetos', count(*) = 0 from public.projects where id = 'p1';
insert into resultado select 'outra empresa não vê a equipe', count(*) = 1 from public.list_company_members();
update public.projects set name = 'hack' where id = 'p1';
update public.companies set name = 'hack' where id = '10000000-0000-0000-0000-000000000001';
reset role;
insert into resultado select 'outra empresa não altera projeto nem empresa', (select name from public.projects where id = 'p1') = 'Projeto 1 (editado)' and (select name from public.companies where id = '10000000-0000-0000-0000-000000000001') = 'Empresa 1';

-- 6) Convite só é aceito por conta com e-mail confirmado
select pg_temp.como('00000000-0000-0000-0000-0000000000ff', 'aal1'); set role authenticated;
insert into resultado select 'conta sem e-mail confirmado não vê o convite', coalesce(jsonb_typeof(public.get_my_context()->'pending_invite'), 'null') = 'null';
do $$ begin perform public.accept_pending_invite(); exception when others then null; end $$;
reset role;
insert into resultado select 'conta sem e-mail confirmado não entra na empresa', not exists (select 1 from public.company_members where user_id = '00000000-0000-0000-0000-0000000000ff');
select pg_temp.como('00000000-0000-0000-0000-00000000000e', 'aal1'); set role authenticated;
select public.accept_pending_invite();
reset role;
insert into resultado select 'convidado com e-mail confirmado entra com o cargo do convite', exists (select 1 from public.company_members where user_id = '00000000-0000-0000-0000-00000000000e' and role = 'member');

-- 7) Ninguém se promove nem mexe em membros direto na tabela
select pg_temp.como('00000000-0000-0000-0000-00000000000b', 'aal1'); set role authenticated;
update public.company_members set role = 'admin' where user_id = '00000000-0000-0000-0000-00000000000b';
do $$ begin perform public.set_member_role('00000000-0000-0000-0000-00000000000b', 'admin');
  insert into resultado values ('projetista não se promove a admin', false);
exception when others then insert into resultado values ('projetista não se promove a admin', true); end $$;
reset role;
insert into resultado select 'projetista continua projetista', role = 'projetista' from public.company_members where user_id = '00000000-0000-0000-0000-00000000000b';

select case when ok then 'ok   ' else 'FALHA' end || '  ' || teste from resultado;
do $$ begin if exists (select 1 from resultado where not ok) then raise exception '% teste(s) de segurança falharam', (select count(*) from resultado where not ok); end if; end $$;
