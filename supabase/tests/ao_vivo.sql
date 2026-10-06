-- Testes da edição ao vivo (permissões do canal privado). Rodam depois das migrações. "ok" ou "FALHA".
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000f1', 'proj@l.com', now()),
  ('00000000-0000-0000-0000-0000000000f2', 'membro@l.com', now()),
  ('00000000-0000-0000-0000-0000000000f3', 'outra@l.com', now());
insert into public.companies (id, name) values
  ('70000000-0000-0000-0000-000000000007', 'Empresa L'), ('80000000-0000-0000-0000-000000000008', 'Outra L');
insert into public.company_members (company_id, user_id, role) values
  ('70000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000f1', 'projetista'),
  ('70000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000f2', 'member'),
  ('80000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000f3', 'admin');
insert into public.projects (id, company_id, name, created_by, data) values
  ('pl', '70000000-0000-0000-0000-000000000007', 'Projeto L', '00000000-0000-0000-0000-0000000000f1', '{}');
insert into realtime.messages (topic, extension, event, payload) values ('project-live:pl', 'broadcast', 'm', '{}');

create temp table r (teste text, ok boolean);
grant all on r to authenticated;
create function pg_temp.como(p_user text, p_topic text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'aal', 'aal1', 'role', 'authenticated')::text, false),
         set_config('realtime.topic', p_topic, false);
$$;

select pg_temp.como('00000000-0000-0000-0000-0000000000f1', 'project-live:pl'); set role authenticated;
insert into r select 'projetista escuta o canal do projeto', count(*) = 1 from realtime.messages;
insert into realtime.messages (topic, extension, event, payload) values ('project-live:pl', 'broadcast', 'm', '{}');
insert into r values ('projetista envia alterações', true);

select pg_temp.como('00000000-0000-0000-0000-0000000000f2', 'project-live:pl');
insert into r select 'membro (só visualiza) escuta o canal', count(*) >= 1 from realtime.messages;
insert into realtime.messages (topic, extension, event, payload) values ('project-live:pl', 'presence', 'presence', '{}');
insert into r values ('membro aparece na presença', true);
do $$ begin insert into realtime.messages (topic, extension, event, payload) values ('project-live:pl', 'broadcast', 'm', '{}');
  insert into r values ('membro não envia alterações', false);
exception when others then insert into r values ('membro não envia alterações', true); end $$;

select pg_temp.como('00000000-0000-0000-0000-0000000000f3', 'project-live:pl');
insert into r select 'outra empresa não escuta o canal', count(*) = 0 from realtime.messages;
do $$ begin insert into realtime.messages (topic, extension, event, payload) values ('project-live:pl', 'presence', 'presence', '{}');
  insert into r values ('outra empresa não entra na presença', false);
exception when others then insert into r values ('outra empresa não entra na presença', true); end $$;

select pg_temp.como('00000000-0000-0000-0000-0000000000f1', 'project-live:nao-existe');
insert into r select 'canal de projeto inexistente fica fechado', count(*) = 0 from realtime.messages;
reset role;

select case when ok then 'ok   ' else 'FALHA' end || '  ' || teste from r;
do $$ begin if exists (select 1 from r where not ok) then raise exception '% teste(s) da edição ao vivo falharam', (select count(*) from r where not ok); end if; end $$;
