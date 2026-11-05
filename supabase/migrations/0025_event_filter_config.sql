-- ============================================================================
-- WISSENDURST'27 — 0025_event_filter_config
--
-- Admin-configurable grouping layer for the public /events filter bar. The
-- seven canonical categories (event_category enum) are unchanged; groups are
-- labelled, ordered unions of one or more categories (overlap allowed).
--
--   event_filter_config   singleton row id=1, config jsonb:
--     { "allLabel": text,
--       "groups": [ { "id", "slug", "label", "enabled", "position",
--                     "categories": [event_category, ...] }, ... ] }   (0–7)
--
-- Seeded with the pre-0025 bar exactly (All + one tab per category in enum
-- order), so deployment changes nothing visually. Public roles may read;
-- writes only through admin_set_event_filter_config() (events scope), which
-- re-validates in PostgreSQL (also enforced by a CHECK constraint).
-- Safe to re-run; never overwrites a saved configuration.
-- ============================================================================

-- Returns null when valid, otherwise a short error code.
create or replace function public.event_filter_config_error(p jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare
  g jsonb;
  i int := 0;
  v_ids text[] := '{}';
  v_slugs text[] := '{}';
  v_cats text[];
  v_canon text[] := array['workshop','debate','poster','paper','competition','academic','other'];
  k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'NOT_OBJECT'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('allLabel', 'groups') then return 'UNKNOWN_KEY'; end if;
  end loop;
  if jsonb_typeof(p->'allLabel') is distinct from 'string'
     or char_length(p->>'allLabel') not between 1 and 40
     or p->>'allLabel' <> btrim(p->>'allLabel') then
    return 'INVALID_ALL_LABEL';
  end if;
  if jsonb_typeof(p->'groups') is distinct from 'array' then return 'GROUPS_NOT_ARRAY'; end if;
  if jsonb_array_length(p->'groups') > 7 then return 'TOO_MANY_GROUPS'; end if;

  for g in select value from jsonb_array_elements(p->'groups') loop
    i := i + 1;
    if jsonb_typeof(g) <> 'object' then return 'GROUP_NOT_OBJECT'; end if;
    for k in select jsonb_object_keys(g) loop
      if k not in ('id', 'slug', 'label', 'enabled', 'position', 'categories') then return 'UNKNOWN_GROUP_KEY'; end if;
    end loop;
    if jsonb_typeof(g->'id') is distinct from 'string' or (g->>'id') !~ '^[a-z0-9][a-z0-9-]{0,39}$' then
      return 'INVALID_GROUP_ID';
    end if;
    if jsonb_typeof(g->'slug') is distinct from 'string' or char_length(g->>'slug') > 40
       or (g->>'slug') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or (g->>'slug') = 'all' then
      return 'INVALID_GROUP_SLUG';
    end if;
    if jsonb_typeof(g->'label') is distinct from 'string' or char_length(g->>'label') not between 1 and 40
       or g->>'label' <> btrim(g->>'label') then
      return 'INVALID_GROUP_LABEL';
    end if;
    if jsonb_typeof(g->'enabled') is distinct from 'boolean' then return 'INVALID_GROUP_ENABLED'; end if;
    if jsonb_typeof(g->'position') is distinct from 'number' or (g->>'position') <> i::text then
      return 'INVALID_GROUP_POSITION';
    end if;
    if jsonb_typeof(g->'categories') is distinct from 'array' or jsonb_array_length(g->'categories') = 0 then
      return 'INVALID_GROUP_CATEGORIES';
    end if;
    if exists (select 1 from jsonb_array_elements(g->'categories') c
               where jsonb_typeof(c) <> 'string' or not (c #>> '{}') = any (v_canon)) then
      return 'UNKNOWN_CATEGORY';
    end if;
    select array_agg(c #>> '{}') into v_cats from jsonb_array_elements(g->'categories') c;
    if (select count(distinct x) from unnest(v_cats) x) <> cardinality(v_cats) then
      return 'DUPLICATE_CATEGORY';
    end if;
    if (g->>'id') = any (v_ids) then return 'DUPLICATE_GROUP_ID'; end if;
    if (g->>'slug') = any (v_slugs) then return 'DUPLICATE_GROUP_SLUG'; end if;
    v_ids := v_ids || (g->>'id');
    v_slugs := v_slugs || (g->>'slug');
  end loop;
  return null;
end $$;

create table if not exists public.event_filter_config (
  id         integer primary key default 1 check (id = 1),
  config     jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint event_filter_config_valid check (public.event_filter_config_error(config) is null)
);

-- Seed = the current bar, exactly.
insert into public.event_filter_config (id, config) values (1, $j${
  "allLabel": "All",
  "groups": [
    {"id": "workshop",    "slug": "workshop",    "label": "Workshop",            "enabled": true, "position": 1, "categories": ["workshop"]},
    {"id": "debate",      "slug": "debate",      "label": "Debate",              "enabled": true, "position": 2, "categories": ["debate"]},
    {"id": "poster",      "slug": "poster",      "label": "Poster Presentation", "enabled": true, "position": 3, "categories": ["poster"]},
    {"id": "paper",       "slug": "paper",       "label": "Paper Presentation",  "enabled": true, "position": 4, "categories": ["paper"]},
    {"id": "competition", "slug": "competition", "label": "Competition",         "enabled": true, "position": 5, "categories": ["competition"]},
    {"id": "academic",    "slug": "academic",    "label": "Academic Event",      "enabled": true, "position": 6, "categories": ["academic"]},
    {"id": "other",       "slug": "other",       "label": "Other",               "enabled": true, "position": 7, "categories": ["other"]}
  ]
}$j$::jsonb)
on conflict (id) do nothing;

-- ── access: public read, RPC-only writes ───────────────────────────────────
alter table public.event_filter_config enable row level security;
revoke all on public.event_filter_config from public, anon, authenticated;
grant select on public.event_filter_config to anon, authenticated;
drop policy if exists event_filter_config_read on public.event_filter_config;
create policy event_filter_config_read on public.event_filter_config for select using (true);

create or replace function public.admin_set_event_filter_config(p_config jsonb)
returns public.event_filter_config
language plpgsql security definer set search_path = public as $$
declare
  v_err text;
  v_row public.event_filter_config;
begin
  if not public.has_admin_scope('events') then raise exception 'FORBIDDEN'; end if;
  v_err := public.event_filter_config_error(p_config);
  if v_err is not null then raise exception 'INVALID_FILTER_CONFIG' using detail = v_err; end if;
  insert into public.event_filter_config (id, config, updated_at, updated_by)
  values (1, p_config, now(), auth.uid())
  on conflict (id) do update set config = excluded.config, updated_at = now(), updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end $$;

revoke execute on function public.admin_set_event_filter_config(jsonb) from public, anon;
grant execute on function public.admin_set_event_filter_config(jsonb) to authenticated;
