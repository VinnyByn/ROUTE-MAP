-- Imitação mínima do Supabase para testar as migrações
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth; create schema extensions;
grant usage on schema public, auth, extensions to anon, authenticated;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
create type auth.factor_status as enum ('unverified', 'verified');
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id), factor_type text default 'totp', status auth.factor_status not null, created_at timestamptz default now());
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub', '')::uuid $$;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
-- Realtime (canais privados): tabela de mensagens e o tópico do canal atual
create schema if not exists realtime;
create table realtime.messages (id bigserial primary key, topic text not null, extension text not null, event text, payload jsonb, private boolean default true);
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
grant usage on schema realtime to authenticated;
grant select, insert on realtime.messages to authenticated;
grant usage on sequence realtime.messages_id_seq to authenticated;
grant execute on function realtime.topic() to authenticated;
