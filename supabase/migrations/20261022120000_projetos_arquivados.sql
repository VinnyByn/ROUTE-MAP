-- ROUTE MAP — projetos arquivados
--
-- Cada projeto pode ser arquivado (sai da lista "Abrir projeto" e vai para a aba Arquivados) e/ou migrado para o
-- modo Rede (caixas, cabos e planos de fusão vão para a rede da cidade). Projeto migrado é arquivado junto.
-- A rede de cada cidade (project_type = 'Rede') não aparece na lista de projetos: ela abre pelo modo Rede.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase ANTES de publicar a versão que arquiva projetos.

alter table public.projects
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users (id) on delete set null;

create index if not exists projects_company_archived on public.projects (company_id, archived_at);

-- Projetos já enviados para a rede (data.concluded) entram arquivados
update public.projects
set archived_at = coalesce(nullif(data->'concluded'->>'at', '')::timestamptz, updated_at, now())
where archived_at is null and data ? 'concluded';

-- Lista paginada: ativos ou arquivados (p_archived), sem as redes das cidades
drop function if exists public.search_projects(text, text, text, text, integer, integer);
create or replace function public.search_projects(
  p_term text default null,
  p_type text default null,
  p_city text default null,
  p_sort text default 'recent',
  p_limit integer default 20,
  p_offset integer default 0,
  p_archived boolean default false
)
returns table (
  id text,
  name text,
  city text,
  neighborhood text,
  project_type text,
  created_at timestamptz,
  updated_at timestamptz,
  created_by_name text,
  updated_by_name text,
  summary jsonb,
  total_count bigint,
  archived_at timestamptz,
  concluded boolean
)
language sql stable
set search_path = ''
as $$
  with words as (
    select replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') as w
    from unnest(string_to_array(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_term, ''))), ' ')) w
    where w <> ''
  ), filtered as (
    select p.*
    from public.projects p
    where p.company_id = public.my_company_id()
      and p.deleted_at is null
      and coalesce(p.project_type, '') <> 'Rede'
      and (p.archived_at is not null) = coalesce(p_archived, false)
      and (coalesce(p_type, '') = '' or p.project_type = p_type)
      and (coalesce(p_city, '') = '' or p.city = p_city)
      and not exists (select 1 from words where p.search_text not like '%' || words.w || '%')
  )
  select f.id, f.name, f.city, f.neighborhood, f.project_type, f.created_at, f.updated_at,
         nullif(trim(cp.full_name), ''), nullif(trim(up.full_name), ''),
         f.summary, count(*) over (), f.archived_at, f.data ? 'concluded'
  from filtered f
  left join public.profiles cp on cp.id = f.created_by
  left join public.profiles up on up.id = f.updated_by
  order by
    case when p_sort = 'name' then lower(f.name) end asc,
    case when p_sort = 'city' then lower(coalesce(f.city, '')) end asc,
    case when p_sort = 'oldest' then f.updated_at end asc,
    f.updated_at desc,
    f.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Contagens dos filtros: projetos ativos (sem as redes), arquivados e lixeira; cidades de todos os projetos
create or replace function public.project_facets()
returns jsonb
language sql stable
set search_path = ''
as $$
  with live as (
    select * from public.projects
    where company_id = public.my_company_id() and deleted_at is null and coalesce(project_type, '') <> 'Rede'
  )
  select jsonb_build_object(
    'total', (select count(*) from live where archived_at is null),
    'archived', (select count(*) from live where archived_at is not null),
    'trash', (select count(*) from public.projects where company_id = public.my_company_id() and deleted_at is not null),
    'types', coalesce((
      select jsonb_agg(jsonb_build_object('value', project_type, 'count', n) order by n desc, project_type)
      from (select project_type, count(*) n from live
            where archived_at is null and coalesce(project_type, '') <> ''
            group by project_type) t
    ), '[]'::jsonb),
    'cities', coalesce((
      select jsonb_agg(jsonb_build_object('value', city, 'count', n) order by city)
      from (select city, count(*) n from live
            where coalesce(trim(city), '') <> ''
            group by city) c
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.search_projects(text, text, text, text, integer, integer, boolean), public.project_facets() from public, anon;
grant execute on function public.search_projects(text, text, text, text, integer, integer, boolean), public.project_facets() to authenticated;
