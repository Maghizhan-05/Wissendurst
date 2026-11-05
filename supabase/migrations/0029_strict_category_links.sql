-- ============================================================================
-- WISSENDURST'27 — 0029_strict_category_links
--
-- Removes 0028's exception that let an existing filter tab keep a slug equal
-- to an unrelated category's slug. A tab may use a category's slug only when
-- it shows exactly that one category, so every category URL
-- (/events?category=<slug>) opens that category directly or a one-category
-- tab containing it. Aborts if the stored configuration violates this.
-- Safe to re-run.
-- ============================================================================

create or replace function public.event_filter_config_error(p jsonb, p_previous jsonb)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  g jsonb;
  i int := 0;
  v_ids text[] := '{}';
  v_slugs text[] := '{}';
  v_cats text[];
  v_prev jsonb := case when jsonb_typeof(p_previous->'groups') = 'array' then p_previous->'groups' else '[]'::jsonb end;
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
    if jsonb_array_length(g->'categories') > 50 then return 'TOO_MANY_CATEGORIES'; end if;
    if exists (select 1 from jsonb_array_elements(g->'categories') c
               where jsonb_typeof(c) <> 'string'
                  or (c #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  or not exists (select 1 from public.event_categories ec where ec.id = (c #>> '{}')::uuid)) then
      return 'UNKNOWN_CATEGORY';
    end if;
    select array_agg(c #>> '{}') into v_cats from jsonb_array_elements(g->'categories') c;
    if (select count(distinct x) from unnest(v_cats) x) <> cardinality(v_cats) then
      return 'DUPLICATE_CATEGORY';
    end if;
    -- A tab slug equal to a category slug would shadow that category's
    -- ?category= link (tabs resolve first). Allowed only when the tab shows
    -- exactly that one category — no exceptions for existing tabs (0029).
    if exists (select 1 from public.event_categories ec
               where ec.slug = g->>'slug'
                 and not (cardinality(v_cats) = 1 and v_cats[1] = ec.id::text)) then
      return 'GROUP_SLUG_SHADOWS_CATEGORY';
    end if;
    if exists (select 1 from unnest(v_cats) x
               join public.event_categories ec on ec.id = x::uuid
               where ec.archived_at is not null
                 and not exists (select 1 from jsonb_array_elements(v_prev) pg
                                 where pg->>'id' = g->>'id'
                                   and jsonb_typeof(pg->'categories') = 'array'
                                   and pg->'categories' ? x)) then
      return 'ARCHIVED_CATEGORY';
    end if;
    if (g->>'id') = any (v_ids) then return 'DUPLICATE_GROUP_ID'; end if;
    if (g->>'slug') = any (v_slugs) then return 'DUPLICATE_GROUP_SLUG'; end if;
    v_ids := v_ids || (g->>'id');
    v_slugs := v_slugs || (g->>'slug');
  end loop;
  return null;
end $$;
revoke execute on function public.event_filter_config_error(jsonb, jsonb) from public, anon, authenticated;

-- Category slugs whose public link would open something other than the category.
create or replace function public.event_category_url_conflicts()
returns table (category_slug text, group_id text, group_label text)
language sql stable security definer set search_path = public as $$
  select ec.slug, g->>'id', g->>'label'
  from public.event_filter_config f,
       jsonb_array_elements(case when jsonb_typeof(f.config->'groups') = 'array' then f.config->'groups' else '[]'::jsonb end) g,
       public.event_categories ec
  where g->>'slug' = ec.slug
    and not (jsonb_typeof(g->'categories') = 'array'
             and jsonb_array_length(g->'categories') = 1
             and g->'categories'->>0 = ec.id::text)
$$;
revoke execute on function public.event_category_url_conflicts() from public, anon, authenticated;

do $$
declare v_err text; v_bad text;
begin
  select string_agg(category_slug || ' -> ' || group_label, ', ') into v_bad from public.event_category_url_conflicts();
  if v_bad is not null then
    raise exception 'CATEGORY_URL_CONFLICT' using detail = v_bad;
  end if;
  select public.event_filter_config_error(config, config) into v_err from public.event_filter_config where id = 1;
  if v_err is not null then
    raise exception 'INVALID_FILTER_CONFIG' using detail = v_err;
  end if;
end $$;
