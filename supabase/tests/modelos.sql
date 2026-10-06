-- Testes dos modelos de caixa. Rodam depois das migrações (supabase/tests/run.sh). Cada linha: "ok" ou "FALHA".
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'admin@m.com', now()),
  ('00000000-0000-0000-0000-0000000000e2', 'proj@m.com', now()),
  ('00000000-0000-0000-0000-0000000000e3', 'proj2@m.com', now()),
  ('00000000-0000-0000-0000-0000000000e4', 'membro@m.com', now()),
  ('00000000-0000-0000-0000-0000000000e5', 'outra@m.com', now());
insert into public.companies (id, name) values
  ('50000000-0000-0000-0000-000000000005', 'Empresa M'), ('60000000-0000-0000-0000-000000000006', 'Outra M');
insert into public.company_members (company_id, user_id, role) values
  ('50000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000e1', 'admin'),
  ('50000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000e2', 'projetista'),
  ('50000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000e3', 'projetista'),
  ('50000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000e4', 'member'),
  ('60000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000e5', 'admin');

create temp table r (teste text, ok boolean);
grant all on r to authenticated;
create function pg_temp.como(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'aal', 'aal1', 'role', 'authenticated')::text, false);
$$;

select pg_temp.como('00000000-0000-0000-0000-0000000000e2'); set role authenticated;
insert into public.box_templates (company_id, name, box_type, template) values ('50000000-0000-0000-0000-000000000005', 'CEO padrão', 'CEO', '{"splitters":[]}');
insert into r select 'projetista cria modelo (autor gravado)', count(*) = 1 and min(created_by::text) = '00000000-0000-0000-0000-0000000000e2' from public.box_templates;

select pg_temp.como('00000000-0000-0000-0000-0000000000e4');
insert into r select 'membro vê os modelos da empresa', count(*) = 1 from public.box_templates;
do $$ begin insert into public.box_templates (company_id, name, box_type, template) values ('50000000-0000-0000-0000-000000000005', 'x', 'CTO', '{}');
  insert into r values ('membro não cria modelo', false);
exception when others then insert into r values ('membro não cria modelo', true); end $$;

select pg_temp.como('00000000-0000-0000-0000-0000000000e5');
insert into r select 'outra empresa não vê os modelos', count(*) = 0 from public.box_templates;
do $$ begin insert into public.box_templates (company_id, name, box_type, template) values ('50000000-0000-0000-0000-000000000005', 'x', 'CTO', '{}');
  insert into r values ('outra empresa não cria modelo na empresa', false);
exception when others then insert into r values ('outra empresa não cria modelo na empresa', true); end $$;

select pg_temp.como('00000000-0000-0000-0000-0000000000e3');
delete from public.box_templates;
reset role;
insert into r select 'projetista não exclui modelo de outro', count(*) = 1 from public.box_templates;

select pg_temp.como('00000000-0000-0000-0000-0000000000e1'); set role authenticated;
delete from public.box_templates;
reset role;
insert into r select 'administrador exclui modelo', count(*) = 0 from public.box_templates;

select case when ok then 'ok   ' else 'FALHA' end || '  ' || teste from r;
do $$ begin if exists (select 1 from r where not ok) then raise exception '% teste(s) de modelos falharam', (select count(*) from r where not ok); end if; end $$;
