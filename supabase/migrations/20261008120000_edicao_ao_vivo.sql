-- ROUTE MAP — edição simultânea ao vivo (Supabase Realtime, canais privados)
--
-- Cada projeto aberto usa o canal privado "project-live:<id do projeto>". Estas políticas em
-- realtime.messages fazem o Realtime só deixar entrar quem é da empresa do projeto:
--   - escutar (select): membros da empresa do projeto (com 2 etapas, quando ativada);
--   - presença (quem está no projeto): os mesmos;
--   - enviar alterações (broadcast): só quem tem cargo de edição.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase ANTES de publicar a versão que depende dele.
-- Sem ele o sistema funciona normalmente, só sem a edição ao vivo.
-- Testes: supabase/tests/ao_vivo.sql.

create or replace function public.live_project_id(p_topic text)
returns text
language sql immutable
set search_path = ''
as $$
  select case when p_topic like 'project-live:%' then substring(p_topic from 14) end;
$$;

create or replace function public.can_join_live_project(p_topic text)
returns boolean
language sql stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = public.live_project_id(p_topic)
      and p.company_id = public.my_company_id()
  ) and public.mfa_satisfied();
$$;

drop policy if exists "empresa do projeto escuta a edição ao vivo" on realtime.messages;
create policy "empresa do projeto escuta a edição ao vivo" on realtime.messages
  for select to authenticated
  using (public.can_join_live_project(realtime.topic()));

drop policy if exists "empresa do projeto aparece na presença" on realtime.messages;
create policy "empresa do projeto aparece na presença" on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension = 'presence' and public.can_join_live_project(realtime.topic()));

drop policy if exists "quem edita envia alterações ao vivo" on realtime.messages;
create policy "quem edita envia alterações ao vivo" on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension = 'broadcast'
              and public.can_join_live_project(realtime.topic())
              and public.can_edit_projects(public.my_company_id()));

revoke execute on function public.can_join_live_project(text) from public, anon;
grant execute on function public.can_join_live_project(text) to authenticated;
