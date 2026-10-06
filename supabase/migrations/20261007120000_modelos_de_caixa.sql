-- ROUTE MAP — modelos de caixa (plano de fusão padrão)
--
-- Um modelo guarda os splitters de um plano de fusão, as ligações entre eles e as fusões
-- cabo → splitter pela posição do cabo (1º cabo de entrada, fibra N). Aplicar o modelo em outra
-- caixa recria tudo isso. Os modelos são da empresa: todos veem; administrador e projetista criam,
-- e só quem criou ou o administrador exclui.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase ANTES de publicar a versão que depende dele.
-- Testes: supabase/tests/modelos.sql.

create table if not exists public.box_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  box_type text not null check (box_type in ('CEO', 'CTO')),
  template jsonb not null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists box_templates_company on public.box_templates (company_id, box_type, name);

alter table public.box_templates enable row level security;

drop policy if exists "equipe vê os modelos" on public.box_templates;
create policy "equipe vê os modelos" on public.box_templates
  for select to authenticated using (company_id = public.my_company_id());

drop policy if exists "quem edita projetos cria modelos" on public.box_templates;
create policy "quem edita projetos cria modelos" on public.box_templates
  for insert to authenticated
  with check (company_id = public.my_company_id() and created_by = auth.uid() and public.can_edit_projects(company_id));

drop policy if exists "autor ou administrador exclui modelos" on public.box_templates;
create policy "autor ou administrador exclui modelos" on public.box_templates
  for delete to authenticated
  using (company_id = public.my_company_id()
         and (public.is_company_admin(company_id) or (created_by = auth.uid() and public.can_edit_projects(company_id))));

drop policy if exists "exige 2 etapas quando ativada" on public.box_templates;
create policy "exige 2 etapas quando ativada" on public.box_templates as restrictive for all to authenticated
  using (public.mfa_satisfied()) with check (public.mfa_satisfied());

grant select, insert, delete on public.box_templates to authenticated;
