-- Testes de projetos arquivados: somem da lista de ativos, aparecem em Arquivados, só quem edita arquiva.
-- Rodam depois das migrações (supabase/tests/run.sh). Cada linha: "ok" ou "FALHA".
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000002a1', 'proj@arq.com', now()),
  ('00000000-0000-0000-0000-0000000002c1', 'membro@arq.com', now());
insert into public.companies (id, name) values ('ea000000-0000-0000-0000-0000000000ea', 'Empresa Arquivo');
insert into public.company_members (company_id, user_id, role) values
  ('ea000000-0000-0000-0000-0000000000ea', '00000000-0000-0000-0000-0000000002a1', 'projetista'),
  ('ea000000-0000-0000-0000-0000000000ea', '00000000-0000-0000-0000-0000000002c1', 'member');
insert into public.projects (id, company_id, name, project_type, city, data) values
  ('arq_ativo', 'ea000000-0000-0000-0000-0000000000ea', 'Ativo', 'TCR', 'Lavras', '{}'),
  ('arq_velho', 'ea000000-0000-0000-0000-0000000000ea', 'Velho', 'TCR', 'Lavras', '{}'),
  ('arq_rede', 'ea000000-0000-0000-0000-0000000000ea', 'Rede · Lavras', 'Rede', 'Lavras', '{}');

create temp table r (teste text, ok boolean);
grant all on r to authenticated;
create function pg_temp.como(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'aal', 'aal1', 'role', 'authenticated')::text, false);
$$;

select pg_temp.como('00000000-0000-0000-0000-0000000002c1'); set role authenticated;
with u as (update public.projects set archived_at = now() where id = 'arq_velho' returning 1)
insert into r select 'membro não arquiva', not exists (select 1 from u);
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000002a1'); set role authenticated;
insert into r select 'rede da cidade não aparece na lista', not exists (select 1 from public.search_projects() where id = 'arq_rede');
update public.projects set archived_at = now(), archived_by = '00000000-0000-0000-0000-0000000002a1' where id = 'arq_velho';
insert into r select 'arquivar não cria versão', revision = 1 from public.projects where id = 'arq_velho';
insert into r select 'arquivado sai dos ativos', (select string_agg(id, ',') from public.search_projects()) = 'arq_ativo';
insert into r select 'arquivado aparece em Arquivados', (select string_agg(id, ',') from public.search_projects(p_archived => true)) = 'arq_velho';
insert into r select 'contagens: 1 ativo e 1 arquivado', (public.project_facets()->>'total')::int = 1 and (public.project_facets()->>'archived')::int = 1;
update public.projects set archived_at = null where id = 'arq_velho';
insert into r select 'desarquivar volta para os ativos', (select count(*) from public.search_projects()) = 2;
reset role;

select case when ok then 'ok: ' else 'FALHA: ' end || teste from r;
do $$ begin if exists (select 1 from r where not ok) then raise exception 'há testes com falha'; end if; end $$;
