-- ROUTE MAP — cargo Viabilidade (vendas) no lugar de Membro
--
-- Viabilidade (viabilidade): consulta a rede das cidades (viabilidade, caixas, portas, clientes, ocorrências).
--   Só visualiza: não grava nada. Projetos não aparecem, nem as versões deles.
-- Membros: todos passam para Viabilidade. O cargo "member" continua aceito no banco só por compatibilidade
-- (não aparece mais na tela e não pode ser dado a ninguém).
--
-- Rode este arquivo inteiro no SQL Editor do Supabase ANTES de publicar a versão do sistema com o cargo Viabilidade.

-- ---------------------------------------------------------------
-- Cargo
-- ---------------------------------------------------------------

alter table public.company_members drop constraint if exists company_members_role_check;
alter table public.company_invites drop constraint if exists company_invites_role_check;
alter table public.company_members
  add constraint company_members_role_check check (role in ('admin', 'projetista', 'tecnico', 'viabilidade', 'member'));
alter table public.company_invites
  add constraint company_invites_role_check check (role in ('admin', 'projetista', 'tecnico', 'viabilidade', 'member'));
alter table public.company_members alter column role set default 'viabilidade';
alter table public.company_invites alter column role set default 'viabilidade';

update public.company_members set role = 'viabilidade' where role = 'member';
update public.company_invites set role = 'viabilidade' where role = 'member';

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
  if p_role not in ('admin', 'projetista', 'tecnico', 'viabilidade') then
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

--Cargo de quem está logado na empresa (null se não for da empresa)
create or replace function public.my_company_role(p_company uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select role from public.company_members where company_id = p_company and user_id = auth.uid();
$$;

revoke execute on function public.my_company_role(uuid) from public, anon;
grant execute on function public.my_company_role(uuid) to authenticated;

-- ---------------------------------------------------------------
-- Viabilidade vê só a rede
-- ---------------------------------------------------------------

drop policy if exists "viabilidade vê só a rede" on public.projects;
create policy "viabilidade vê só a rede" on public.projects as restrictive
  for select to authenticated
  using (project_type = 'Rede' or public.my_company_role(company_id) is distinct from 'viabilidade');

drop policy if exists "viabilidade vê só versões da rede" on public.project_versions;
create policy "viabilidade vê só versões da rede" on public.project_versions as restrictive
  for select to authenticated
  using (
    public.my_company_role(company_id) is distinct from 'viabilidade'
    or exists (select 1 from public.projects p where p.id = project_id and p.project_type = 'Rede')
  );

create or replace function public.can_join_live_project(p_topic text)
returns boolean
language sql stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = public.live_project_id(p_topic)
      and p.company_id = public.my_company_id()
      and (p.project_type = 'Rede' or public.my_company_role(p.company_id) is distinct from 'viabilidade')
  ) and public.mfa_satisfied();
$$;
