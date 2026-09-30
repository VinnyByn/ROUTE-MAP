-- Busca de projetos no servidor: filtro por texto (sem acento, várias palavras), tipo e cidade,
-- ordenação e paginação. A lista não baixa mais o JSON do projeto (data): um resumo pequeno
-- (contagens e metragem) é calculado pelo próprio banco em colunas geradas.

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Texto de busca: nome, cidade, bairro e tipo, minúsculo e sem acento
create or replace function public.project_search_text(p_name text, p_city text, p_neighborhood text, p_type text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, concat_ws(' ', p_name, p_city, p_neighborhood, p_type)));
$$;

-- Resumo do conteúdo do projeto (sem ler o JSON inteiro na listagem)
create or replace function public.project_summary(p_data jsonb)
returns jsonb
language sql immutable parallel safe
set search_path = ''
as $$
  with m as (
    select e->>'type' as type
    from jsonb_array_elements(case when jsonb_typeof(p_data->'markers') = 'array' then p_data->'markers' else '[]'::jsonb end) e
  ), c as (
    select case when (e->>'totalLength') ~ '^[0-9]+(\.[0-9]+)?$' then (e->>'totalLength')::numeric else 0 end as len
    from jsonb_array_elements(case when jsonb_typeof(p_data->'cables') = 'array' then p_data->'cables' else '[]'::jsonb end) e
  )
  select jsonb_build_object(
    'markers', (select count(*) from m),
    'ctos', (select count(*) from m where type = 'CTO'),
    'ceos', (select count(*) from m where type = 'CEO'),
    'clients', (select count(*) from m where type = 'CLIENTE'),
    'cables', (select count(*) from c),
    'cableMeters', (select coalesce(round(sum(len)), 0) from c)
  );
$$;

alter table public.projects
  add column if not exists search_text text
    generated always as (public.project_search_text(name, city, neighborhood, project_type)) stored,
  add column if not exists summary jsonb
    generated always as (public.project_summary(data)) stored;

create index if not exists projects_search_trgm on public.projects using gin (search_text extensions.gin_trgm_ops);
create index if not exists projects_company_name on public.projects (company_id, lower(name));
create index if not exists projects_company_city on public.projects (company_id, city);

-- Lista paginada. Roda com as permissões de quem chama (RLS da tabela vale normalmente).
create or replace function public.search_projects(
  p_term text default null,
  p_type text default null,
  p_city text default null,
  p_sort text default 'recent',
  p_limit integer default 20,
  p_offset integer default 0
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
  total_count bigint
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
      and (coalesce(p_type, '') = '' or p.project_type = p_type)
      and (coalesce(p_city, '') = '' or p.city = p_city)
      and not exists (select 1 from words where p.search_text not like '%' || words.w || '%')
  )
  select f.id, f.name, f.city, f.neighborhood, f.project_type, f.created_at, f.updated_at,
         nullif(trim(cp.full_name), ''), nullif(trim(up.full_name), ''),
         f.summary, count(*) over ()
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

-- Opções dos filtros (tipos e cidades com a quantidade de projetos)
create or replace function public.project_facets()
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.projects where company_id = public.my_company_id()),
    'types', coalesce((
      select jsonb_agg(jsonb_build_object('value', project_type, 'count', n) order by n desc, project_type)
      from (select project_type, count(*) n from public.projects
            where company_id = public.my_company_id() and coalesce(project_type, '') <> ''
            group by project_type) t
    ), '[]'::jsonb),
    'cities', coalesce((
      select jsonb_agg(jsonb_build_object('value', city, 'count', n) order by city)
      from (select city, count(*) n from public.projects
            where company_id = public.my_company_id() and coalesce(trim(city), '') <> ''
            group by city) c
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.search_projects(text, text, text, text, integer, integer), public.project_facets() from public, anon;
grant execute on function public.search_projects(text, text, text, text, integer, integer), public.project_facets() to authenticated;
