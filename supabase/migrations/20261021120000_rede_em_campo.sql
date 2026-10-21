-- ROUTE MAP — rede em campo: cargo Técnico de campo e fotos das caixas
--
-- Técnico de campo (tecnico): no modo Rede cadastra e liga clientes, registra ocorrências e fotos.
--   Não cria, não exclui nem altera projetos, e na rede não mexe em caixas, cabos e polígonos:
--   o banco confere isso a cada gravação (projects_field_tech_guard).
-- Fotos: bucket privado "rede-fotos", uma pasta por empresa: <empresa>/<rede>/<caixa ou cabo>/<arquivo>.
--   Só a própria empresa vê; administrador, projetista e técnico enviam e apagam.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase ANTES de publicar a versão do sistema que usa o
-- cargo Técnico de campo e as fotos.

-- ---------------------------------------------------------------
-- Cargo
-- ---------------------------------------------------------------

alter table public.company_members drop constraint if exists company_members_role_check;
alter table public.company_invites drop constraint if exists company_invites_role_check;
alter table public.company_members
  add constraint company_members_role_check check (role in ('admin', 'projetista', 'tecnico', 'member'));
alter table public.company_invites
  add constraint company_invites_role_check check (role in ('admin', 'projetista', 'tecnico', 'member'));

create or replace function public.set_member_role(p_user uuid, p_role text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
begin
  perform public.require_mfa();
  if not public.is_company_admin(v_company) then
    raise exception 'Apenas administradores podem alterar cargos.';
  end if;
  if p_role not in ('admin', 'projetista', 'tecnico', 'member') then
    raise exception 'Cargo inválido.';
  end if;
  if p_role <> 'admin' and (
    select count(*) from public.company_members where company_id = v_company and role = 'admin' and user_id <> p_user
  ) = 0 then
    raise exception 'A empresa precisa ter pelo menos um administrador.';
  end if;
  update public.company_members set role = p_role where company_id = v_company and user_id = p_user;
end;
$$;

--Quem documenta a rede (clientes, ocorrências, fotos): administrador, projetista e técnico de campo
create or replace function public.can_document_network(p_company uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.company_members
    where company_id = p_company and user_id = auth.uid() and role in ('admin', 'projetista', 'tecnico')
  );
$$;

-- ---------------------------------------------------------------
-- Técnico de campo grava a rede da cidade (só clientes, ocorrências, fotos e o histórico)
-- ---------------------------------------------------------------

drop policy if exists "técnicos documentam a rede" on public.projects;
create policy "técnicos documentam a rede" on public.projects
  for update to authenticated
  using (company_id = public.my_company_id() and project_type = 'Rede' and public.can_document_network(company_id))
  with check (company_id = public.my_company_id() and project_type = 'Rede' and public.can_document_network(company_id));

--O que é infraestrutura na rede (caixas, cabos e polígonos), no que importa: o resto (clientes, pastas,
--ocorrências, histórico, ordem na lista) o técnico pode mudar
create or replace function public.network_infrastructure(p_data jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  with m as (
    select x from jsonb_array_elements(case when jsonb_typeof(p_data->'markers') = 'array' then p_data->'markers' else '[]'::jsonb end) x
    where x->>'type' is distinct from 'CLIENTE'
  ), c as (
    select x from jsonb_array_elements(case when jsonb_typeof(p_data->'cables') = 'array' then p_data->'cables' else '[]'::jsonb end) x
  ), p as (
    select x from jsonb_array_elements(case when jsonb_typeof(p_data->'polygons') = 'array' then p_data->'polygons' else '[]'::jsonb end) x
  )
  select jsonb_build_object(
    'markers', coalesce((select jsonb_agg(jsonb_build_object(
        'uid', x->'uid', 'type', x->'type', 'name', x->'name', 'folderId', x->'folderId', 'position', x->'position',
        'fusionPlan', x->'fusionPlan', 'ctoStatus', x->'ctoStatus', 'ceoStatus', x->'ceoStatus', 'reservaStatus', x->'reservaStatus',
        'popEquipment', x->'popEquipment')
      order by x->>'uid', x::text) from m), '[]'::jsonb),
    'cables', coalesce((select jsonb_agg(jsonb_build_object(
        'uid', x->'uid', 'name', x->'name', 'type', x->'type', 'folderId', x->'folderId', 'path', x->'path', 'status', x->'status',
        'startAnchorUid', x->'startAnchorUid', 'endAnchorUid', x->'endAnchorUid', 'totalLength', x->'totalLength')
      order by x->>'uid', x::text) from c), '[]'::jsonb),
    'polygons', coalesce((select jsonb_agg(jsonb_build_object('uid', x->'uid', 'path', x->'path') order by x->>'uid', x::text) from p), '[]'::jsonb)
  );
$$;

create or replace function public.projects_field_tech_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or public.can_edit_projects(old.company_id) then
    return new;
  end if;
  if old.project_type is distinct from 'Rede' or new.project_type is distinct from old.project_type
     or new.name is distinct from old.name or new.city is distinct from old.city
     or new.deleted_at is distinct from old.deleted_at then
    raise exception 'O técnico de campo só documenta a rede (clientes, ocorrências e fotos).' using errcode = '42501';
  end if;
  if public.network_infrastructure(new.data) is distinct from public.network_infrastructure(old.data) then
    raise exception 'O técnico de campo não altera caixas, cabos nem polígonos da rede.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_field_tech_guard on public.projects;
create trigger projects_field_tech_guard before update on public.projects
  for each row execute function public.projects_field_tech_guard();

-- ---------------------------------------------------------------
-- Fotos da rede (Storage)
-- ---------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rede-fotos', 'rede-fotos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "empresa vê as fotos da rede" on storage.objects;
create policy "empresa vê as fotos da rede" on storage.objects
  for select to authenticated
  using (bucket_id = 'rede-fotos' and (storage.foldername(name))[1] = public.my_company_id()::text);

drop policy if exists "quem documenta envia fotos da rede" on storage.objects;
create policy "quem documenta envia fotos da rede" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'rede-fotos' and (storage.foldername(name))[1] = public.my_company_id()::text
    and public.can_document_network(public.my_company_id())
  );

drop policy if exists "quem documenta apaga fotos da rede" on storage.objects;
create policy "quem documenta apaga fotos da rede" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'rede-fotos' and (storage.foldername(name))[1] = public.my_company_id()::text
    and public.can_document_network(public.my_company_id())
  );

drop policy if exists "fotos da rede exigem 2 etapas quando ativada" on storage.objects;
create policy "fotos da rede exigem 2 etapas quando ativada" on storage.objects as restrictive
  for all to authenticated
  using (bucket_id <> 'rede-fotos' or public.mfa_satisfied())
  with check (bucket_id <> 'rede-fotos' or public.mfa_satisfied());
