-- Testes do cargo Viabilidade: vê só a rede das cidades e não grava nada; "member" não é mais dado a ninguém.
-- Rodam depois das migrações (supabase/tests/run.sh). Cada linha: "ok" ou "FALHA".
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000003a1', 'admin@viab.com', now()),
  ('00000000-0000-0000-0000-0000000003b1', 'proj@viab.com', now()),
  ('00000000-0000-0000-0000-0000000003c1', 'vendas@viab.com', now()),
  ('00000000-0000-0000-0000-0000000003d1', 'antigo@viab.com', now());
insert into public.companies (id, name) values ('fa000000-0000-0000-0000-0000000000fa', 'Empresa Viab');
insert into public.company_members (company_id, user_id, role) values
  ('fa000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-0000000003a1', 'admin'),
  ('fa000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-0000000003b1', 'projetista'),
  ('fa000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-0000000003c1', 'viabilidade'),
  ('fa000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-0000000003d1', 'member');
insert into public.projects (id, company_id, name, project_type, city, data) values
  ('viab_rede', 'fa000000-0000-0000-0000-0000000000fa', 'Rede · Lavras', 'Rede', 'Lavras', '{"markers":[]}'),
  ('viab_proj', 'fa000000-0000-0000-0000-0000000000fa', 'Bairro Novo', 'TCR', 'Lavras', '{"markers":[]}');

create temp table r (teste text, ok boolean);
grant all on r to authenticated;
create function pg_temp.como(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'aal', 'aal1', 'role', 'authenticated')::text, false);
$$;
create function pg_temp.tenta(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  return false;
end;
$$;

-- Projetista salva a rede e o projeto (cada um ganha uma versão no histórico)
select pg_temp.como('00000000-0000-0000-0000-0000000003b1'); set role authenticated;
update public.projects set data = '{"markers":[{"uid":"cto1","type":"CTO","name":"CTO-1"}]}' where id in ('viab_rede', 'viab_proj');
insert into r select 'projetista vê a rede e o projeto', count(*) = 2 from public.projects where company_id = 'fa000000-0000-0000-0000-0000000000fa';
reset role;

-- Viabilidade: só a rede, só leitura
select pg_temp.como('00000000-0000-0000-0000-0000000003c1'); set role authenticated;
insert into r select 'viabilidade vê a rede da cidade', exists (select 1 from public.projects where id = 'viab_rede');
insert into r select 'viabilidade não vê projetos', not exists (select 1 from public.projects where id = 'viab_proj');
insert into r select 'viabilidade não acha projetos na busca', not exists (select 1 from public.search_projects());
insert into r select 'viabilidade vê versões só da rede', (select string_agg(distinct project_id, ',') from public.project_versions) = 'viab_rede';
with u as (update public.projects set data = '{"markers":[]}' where id = 'viab_rede' returning 1)
insert into r select 'viabilidade não grava a rede', not exists (select 1 from u);
insert into r select 'viabilidade não cria projeto', not pg_temp.tenta($q$
  insert into public.projects (id, company_id, name, created_by) values ('vx', 'fa000000-0000-0000-0000-0000000000fa', 'X', '00000000-0000-0000-0000-0000000003c1') $q$);
insert into r select 'viabilidade não envia foto', not pg_temp.tenta($q$
  insert into storage.objects (bucket_id, name) values ('rede-fotos', 'fa000000-0000-0000-0000-0000000000fa/viab_rede/cto1/a.jpg') $q$);
insert into r select 'viabilidade entra na edição ao vivo só da rede',
  public.can_join_live_project('project-live:viab_rede') and not public.can_join_live_project('project-live:viab_proj');
reset role;

-- Administrador: dá o cargo Viabilidade; "member" não é mais aceito
select pg_temp.como('00000000-0000-0000-0000-0000000003a1'); set role authenticated;
insert into r select 'administrador dá o cargo Viabilidade', pg_temp.tenta($q$
  select public.set_member_role('00000000-0000-0000-0000-0000000003d1', 'viabilidade') $q$);
insert into r select 'antigo membro virou Viabilidade', role = 'viabilidade' from public.company_members where user_id = '00000000-0000-0000-0000-0000000003d1';
insert into r select 'cargo Membro não é mais dado', not pg_temp.tenta($q$
  select public.set_member_role('00000000-0000-0000-0000-0000000003d1', 'member') $q$);
reset role;
insert into r select 'convite novo começa como Viabilidade', column_default like '''viabilidade''%'
  from information_schema.columns where table_schema = 'public' and table_name = 'company_invites' and column_name = 'role';

select case when ok then 'ok: ' else 'FALHA: ' end || teste from r;
do $$ begin if exists (select 1 from r where not ok) then raise exception 'há testes com falha'; end if; end $$;
