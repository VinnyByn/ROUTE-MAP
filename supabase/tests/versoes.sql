-- Testes de conflito ao salvar, histórico de versões, lixeira e registro de erros.
-- Rodam depois das migrações (supabase/tests/run.sh). Cada linha: "ok" ou "FALHA".
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@v.com', now()),
  ('00000000-0000-0000-0000-0000000000b1', 'proj1@v.com', now()),
  ('00000000-0000-0000-0000-0000000000b2', 'proj2@v.com', now()),
  ('00000000-0000-0000-0000-0000000000c1', 'membro@v.com', now()),
  ('00000000-0000-0000-0000-0000000000d1', 'outra@v.com', now());
insert into public.profiles (id, full_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Ana Admin'), ('00000000-0000-0000-0000-0000000000b1', 'Bruno Projetista'),
  ('00000000-0000-0000-0000-0000000000b2', 'Bia Projetista'), ('00000000-0000-0000-0000-0000000000c1', 'Caio Membro'),
  ('00000000-0000-0000-0000-0000000000d1', 'Davi Outra')
on conflict (id) do update set full_name = excluded.full_name;
insert into public.companies (id, name) values
  ('30000000-0000-0000-0000-000000000003', 'Empresa V'), ('40000000-0000-0000-0000-000000000004', 'Outra V');
insert into public.company_members (company_id, user_id, role) values
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b1', 'projetista'),
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b2', 'projetista'),
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c1', 'member'),
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000d1', 'admin');

create temp table r (teste text, ok boolean);
grant all on r to authenticated;
create function pg_temp.como(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'aal', 'aal1', 'role', 'authenticated')::text, false);
$$;

-- Bruno cria o projeto
select pg_temp.como('00000000-0000-0000-0000-0000000000b1'); set role authenticated;
insert into public.projects (id, company_id, name, created_by, data, revision)
values ('pv', '30000000-0000-0000-0000-000000000003', 'Projeto V', '00000000-0000-0000-0000-0000000000b1', '{"markers":[1]}', 99);
insert into r select 'projeto novo começa na revisão 1', revision = 1 from public.projects where id = 'pv';

-- Bruno e Bia abriram na revisão 1. Bia salva primeiro; Bruno tenta salvar com a revisão antiga.
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
with u as (update public.projects set data = '{"markers":[1,2]}' where id = 'pv' and revision = 1 returning revision)
insert into r select 'salvar com a revisão aberta grava e sobe a revisão', (select revision from u) = 2;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
with u as (update public.projects set data = '{"markers":[9]}' where id = 'pv' and revision = 1 returning revision)
insert into r select 'salvar com revisão desatualizada não grava nada', not exists (select 1 from u);
insert into r select 'conteúdo da Bia continua no projeto', data = '{"markers":[1,2]}' from public.projects where id = 'pv';

-- Histórico
insert into r select 'versão anterior guardada no histórico', count(*) = 1 and min(revision) = 1 from public.list_project_versions('pv');
insert into r select 'histórico mostra quem salvou e quantos itens', (select saved_by_name = 'Bruno Projetista' and markers = 1 from public.list_project_versions('pv') limit 1);
update public.projects set city = 'Cidade' where id = 'pv';
insert into r select 'mudar só a cidade também gera versão', revision = 3 from public.projects where id = 'pv';
update public.projects set updated_at = now() where id = 'pv';
insert into r select 'gravação sem mudança de conteúdo não gera versão', revision = 3 from public.projects where id = 'pv';
do $$ begin for i in 1..25 loop update public.projects set data = jsonb_build_object('i', i) where id = 'pv'; end loop; end $$;
insert into r select 'histórico guarda só as 20 versões mais recentes', count(*) = 20 from public.list_project_versions('pv');

-- Restaurar versão
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1'); set role authenticated;
select public.restore_project_version((select id from public.list_project_versions('pv') order by revision asc limit 1));
insert into r select 'restaurar versão traz o conteúdo dela de volta', (data ? 'i') from public.projects where id = 'pv';

select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
do $$ begin perform public.restore_project_version((select id from public.list_project_versions('pv') limit 1));
  insert into r values ('membro não restaura versão', false);
exception when others then insert into r values ('membro não restaura versão', true); end $$;

select pg_temp.como('00000000-0000-0000-0000-0000000000d1');
insert into r select 'outra empresa não vê o histórico', count(*) = 0 from public.list_project_versions('pv');
insert into r select 'outra empresa não lê versões direto', count(*) = 0 from public.project_versions;

-- Lixeira
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
do $$ begin update public.projects set deleted_at = now() where id = 'pv';
  insert into r values ('projetista que não é autor não move para a lixeira', false);
exception when others then insert into r values ('projetista que não é autor não move para a lixeira', true); end $$;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
update public.projects set deleted_at = now() where id = 'pv';
insert into r select 'autor move para a lixeira', deleted_at is not null and deleted_by = '00000000-0000-0000-0000-0000000000b1' from public.projects where id = 'pv';
insert into r select 'projeto na lixeira some da busca', count(*) = 0 from public.search_projects();
insert into r select 'contagem da lixeira nos filtros', (public.project_facets()->>'trash')::int = 1 and (public.project_facets()->>'total')::int = 0;
insert into r select 'lixeira lista o projeto e quem excluiu', (select deleted_by_name = 'Bruno Projetista' and can_manage from public.list_trash() where id = 'pv');
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
update public.projects set deleted_at = null where id = 'pv';
insert into r select 'administrador restaura da lixeira', deleted_at is null and deleted_by is null from public.projects where id = 'pv';
insert into r select 'projeto restaurado volta para a busca', count(*) = 1 from public.search_projects();
reset role;
update public.projects set deleted_at = now() - interval '31 days' where id = 'pv';
select pg_temp.como('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select count(*) from public.list_trash();
reset role;
insert into r select 'lixeira apaga de vez depois de 30 dias (e o histórico junto)',
  not exists (select 1 from public.projects where id = 'pv') and not exists (select 1 from public.project_versions where project_id = 'pv');

-- Registro de erros
select pg_temp.como('00000000-0000-0000-0000-0000000000c1'); set role authenticated;
insert into public.client_errors (company_id, user_id, message) values ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c1', 'erro do membro');
do $$ begin insert into public.client_errors (company_id, user_id, message) values ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'fingindo ser outro');
  insert into r values ('ninguém registra erro em nome de outro', false);
exception when others then insert into r values ('ninguém registra erro em nome de outro', true); end $$;
insert into r select 'membro não lê os erros', count(*) = 0 from public.client_errors;
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
insert into r select 'administrador lê os erros da empresa', count(*) = 1 from public.client_errors;
select pg_temp.como('00000000-0000-0000-0000-0000000000d1');
insert into r select 'outra empresa não lê os erros', count(*) = 0 from public.client_errors;
reset role;

select case when ok then 'ok   ' else 'FALHA' end || '  ' || teste from r;
do $$ begin if exists (select 1 from r where not ok) then raise exception '% teste(s) de versões/lixeira/erros falharam', (select count(*) from r where not ok); end if; end $$;
