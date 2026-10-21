-- Testes do cargo Técnico de campo (só documenta a rede) e das fotos da rede no Storage.
-- Rodam depois das migrações (supabase/tests/run.sh). Cada linha: "ok" ou "FALHA".
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000001a1', 'admin@campo.com', now()),
  ('00000000-0000-0000-0000-0000000001b1', 'proj@campo.com', now()),
  ('00000000-0000-0000-0000-0000000001e1', 'tecnico@campo.com', now()),
  ('00000000-0000-0000-0000-0000000001c1', 'membro@campo.com', now()),
  ('00000000-0000-0000-0000-0000000001d1', 'tecnico@outra.com', now());
insert into public.companies (id, name) values
  ('da000000-0000-0000-0000-0000000000da', 'Empresa Campo'), ('db000000-0000-0000-0000-0000000000db', 'Outra Campo');
insert into public.company_members (company_id, user_id, role) values
  ('da000000-0000-0000-0000-0000000000da', '00000000-0000-0000-0000-0000000001a1', 'admin'),
  ('da000000-0000-0000-0000-0000000000da', '00000000-0000-0000-0000-0000000001b1', 'projetista'),
  ('da000000-0000-0000-0000-0000000000da', '00000000-0000-0000-0000-0000000001e1', 'tecnico'),
  ('da000000-0000-0000-0000-0000000000da', '00000000-0000-0000-0000-0000000001c1', 'member'),
  ('db000000-0000-0000-0000-0000000000db', '00000000-0000-0000-0000-0000000001d1', 'tecnico');
insert into public.projects (id, company_id, name, project_type, city, data) values
  ('rede_campo', 'da000000-0000-0000-0000-0000000000da', 'Rede · Campo', 'Rede', 'Campo',
   '{"markers":[{"uid":"cto1","type":"CTO","name":"CTO-1","position":{"lat":-21,"lng":-45},"order":0}],"cables":[{"uid":"cb1","name":"FO-1","path":[{"lat":-21,"lng":-45}]}],"polygons":[]}'),
  ('proj_campo', 'da000000-0000-0000-0000-0000000000da', 'Projeto Campo', 'TCR', 'Campo', '{"markers":[]}');

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

-- Técnico: cliente novo, ocorrência e ordem na lista passam; caixa, cabo, nome e lixeira não
select pg_temp.como('00000000-0000-0000-0000-0000000001e1'); set role authenticated;
insert into r select 'técnico grava cliente e ocorrência na rede', pg_temp.tenta($q$
  update public.projects set data = '{"markers":[{"uid":"cto1","type":"CTO","name":"CTO-1","position":{"lat":-21,"lng":-45},"order":3},{"uid":"cli1","type":"CLIENTE","name":"Ana","client":{"ctoUid":"cto1","ctoPort":1}}],"cables":[{"uid":"cb1","name":"FO-1","path":[{"lat":-21,"lng":-45}]}],"polygons":[],"occurrences":[{"id":"oc1","uid":"cto1","kind":"rompimento","status":"aberta"}]}'
  where id = 'rede_campo' $q$);
insert into r select 'cliente do técnico ficou gravado', data->'markers'->1->>'name' = 'Ana' and data->'occurrences'->0->>'id' = 'oc1' from public.projects where id = 'rede_campo';
insert into r select 'técnico não move a caixa', not pg_temp.tenta($q$
  update public.projects set data = jsonb_set(data, '{markers,0,position}', '{"lat":-22,"lng":-45}') where id = 'rede_campo' $q$);
insert into r select 'técnico não renomeia o cabo', not pg_temp.tenta($q$
  update public.projects set data = jsonb_set(data, '{cables,0,name}', '"FO-X"') where id = 'rede_campo' $q$);
insert into r select 'técnico não cria caixa', not pg_temp.tenta($q$
  update public.projects set data = jsonb_set(data, '{markers}', (data->'markers') || '[{"uid":"ceo9","type":"CEO","name":"CEO-9"}]') where id = 'rede_campo' $q$);
insert into r select 'técnico não renomeia a rede nem manda para a lixeira', not pg_temp.tenta($q$ update public.projects set name = 'X' where id = 'rede_campo' $q$)
  and not pg_temp.tenta($q$ update public.projects set deleted_at = now() where id = 'rede_campo' $q$);
with u as (update public.projects set data = '{"markers":[]}' where id = 'proj_campo' returning 1)
insert into r select 'técnico não altera projeto', not exists (select 1 from u);
insert into r select 'técnico não cria projeto', not pg_temp.tenta($q$
  insert into public.projects (id, company_id, name, created_by) values ('px', 'da000000-0000-0000-0000-0000000000da', 'X', '00000000-0000-0000-0000-0000000001e1') $q$);
insert into r select 'técnico lê a rede e os projetos da empresa', count(*) = 2 from public.projects where company_id = 'da000000-0000-0000-0000-0000000000da';
insert into r select 'técnico envia foto na pasta da empresa', pg_temp.tenta($q$
  insert into storage.objects (bucket_id, name) values ('rede-fotos', 'da000000-0000-0000-0000-0000000000da/rede_campo/cto1/a.jpg') $q$);
insert into r select 'técnico não envia foto na pasta de outra empresa', not pg_temp.tenta($q$
  insert into storage.objects (bucket_id, name) values ('rede-fotos', 'db000000-0000-0000-0000-0000000000db/rede_x/cto1/a.jpg') $q$);
reset role;

-- Membro só vê; técnico de outra empresa não vê nada
select pg_temp.como('00000000-0000-0000-0000-0000000001c1'); set role authenticated;
with u as (update public.projects set data = '{}' where id = 'rede_campo' returning 1)
insert into r select 'membro não grava a rede', not exists (select 1 from u);
insert into r select 'membro vê as fotos da empresa', count(*) = 1 from storage.objects where bucket_id = 'rede-fotos';
insert into r select 'membro não envia foto', not pg_temp.tenta($q$
  insert into storage.objects (bucket_id, name) values ('rede-fotos', 'da000000-0000-0000-0000-0000000000da/rede_campo/cto1/b.jpg') $q$);
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000001d1'); set role authenticated;
insert into r select 'técnico de outra empresa não vê as fotos', count(*) = 0 from storage.objects where bucket_id = 'rede-fotos';
with u as (update public.projects set data = '{}' where id = 'rede_campo' returning 1)
insert into r select 'técnico de outra empresa não grava a rede', not exists (select 1 from u);
reset role;

-- Projetista continua mexendo na infraestrutura; administrador dá o cargo de técnico
select pg_temp.como('00000000-0000-0000-0000-0000000001b1'); set role authenticated;
insert into r select 'projetista move a caixa da rede', pg_temp.tenta($q$
  update public.projects set data = jsonb_set(data, '{markers,0,position}', '{"lat":-22,"lng":-45}') where id = 'rede_campo' $q$);
insert into r select 'caixa movida pelo projetista ficou gravada', data->'markers'->0->'position'->>'lat' = '-22' from public.projects where id = 'rede_campo';
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000001a1'); set role authenticated;
insert into r select 'administrador dá o cargo de técnico de campo', pg_temp.tenta($q$
  select public.set_member_role('00000000-0000-0000-0000-0000000001c1', 'tecnico') $q$);
insert into r select 'membro virou técnico de campo', role = 'tecnico' from public.company_members where user_id = '00000000-0000-0000-0000-0000000001c1';
reset role;

select case when ok then 'ok: ' else 'FALHA: ' end || teste from r;
do $$ begin if exists (select 1 from r where not ok) then raise exception 'há testes com falha'; end if; end $$;
