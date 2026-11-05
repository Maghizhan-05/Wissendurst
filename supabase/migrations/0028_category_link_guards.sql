-- ============================================================================
-- WISSENDURST'27 — 0028_category_link_guards
--
-- Final-review fixes for 0027:
--   (1) Category slugs vs filter-tab slugs. `?category=x` resolves a tab slug
--       before a category slug, so a collision hides the category's link.
--       * A new category can't take a slug a filter tab uses.
--       * A tab can't get a new/changed slug equal to a category slug unless
--         it shows exactly that category. A tab that already had its slug
--         (same id) keeps it — the live "workshop" tab (Workshops -> Poster
--         Presentation) is pre-existing behaviour and stays as it is.
--   (2) Permanent delete also respects the BUILT-IN homepage boxes: while no
--       box list is stored, the app shows the defaults, which link to the
--       categories below (mirrors DEFAULT_BOXES in lib/content/landing.ts; a
--       unit test compares them).
-- Safe to re-run.
-- ============================================================================

create or replace function public.homepage_default_category_slugs()
returns text[] language sql immutable set search_path = public as $$
  select array['workshop','debate','poster','paper','competition','academic']
$$;
revoke execute on function public.homepage_default_category_slugs() from public, anon, authenticated;

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
    -- ?category= link (tabs resolve first). Allowed when the tab shows exactly
    -- that category, or when the same tab (same id) already had this slug.
    if exists (select 1 from public.event_categories ec
               where ec.slug = g->>'slug'
                 and not (cardinality(v_cats) = 1 and v_cats[1] = ec.id::text))
       and not exists (select 1 from jsonb_array_elements(v_prev) pg
                       where pg->>'id' = g->>'id' and pg->>'slug' = g->>'slug') then
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

create or replace function public.admin_create_event_category(
  p_slug text, p_label text, p_icon_key text, p_color_key text)
returns public.event_categories
language plpgsql security definer set search_path = public as $$
declare
  v_slug text := btrim(coalesce(p_slug, ''));
  v_label text := btrim(coalesce(p_label, ''));
  v_row public.event_categories;
begin
  if not public.has_admin_scope('events') then raise exception 'FORBIDDEN'; end if;
  if char_length(v_slug) not between 1 and 40 or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or v_slug = 'all' then
    raise exception 'INVALID_CATEGORY_SLUG';
  end if;
  perform public.event_category_check_fields(v_label, p_icon_key, p_color_key);
  perform public.lock_event_categories();
  perform public.lock_event_category(v_slug);
  if exists (select 1 from public.event_categories where slug = v_slug) then
    raise exception 'CATEGORY_SLUG_TAKEN';
  end if;
  -- ... nor one a filter tab already uses (the tab would shadow its links).
  if exists (select 1 from public.event_filter_config f,
                  jsonb_array_elements(case when jsonb_typeof(f.config->'groups') = 'array'
                                            then f.config->'groups' else '[]'::jsonb end) g
             where g->>'slug' = v_slug) then
    raise exception 'CATEGORY_SLUG_USED_BY_FILTER_TAB';
  end if;
  if exists (select 1 from public.event_categories where lower(label) = lower(v_label)) then
    raise exception 'CATEGORY_LABEL_TAKEN';
  end if;
  if (select count(*) from public.event_categories) >= 50 then
    raise exception 'TOO_MANY_CATEGORIES';
  end if;
  insert into public.event_categories (slug, label, position, icon_key, color_key, created_by, updated_by)
  values (v_slug, v_label, (select coalesce(max(position), 0) + 1 from public.event_categories),
          p_icon_key, p_color_key, auth.uid(), auth.uid())
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.admin_delete_event_category(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_slug text;
begin
  if not public.has_admin_scope('events') then raise exception 'FORBIDDEN'; end if;
  perform public.lock_event_categories();
  select slug into v_slug from public.event_categories where id = p_id;
  if not found then raise exception 'CATEGORY_NOT_FOUND'; end if;
  perform public.lock_event_category(v_slug);
  perform 1 from public.event_categories where id = p_id for update;
  if v_slug = 'other' then raise exception 'CATEGORY_PROTECTED'; end if;
  if exists (select 1 from public.events where category = v_slug) then
    raise exception 'CATEGORY_IN_USE' using detail = 'EVENTS';
  end if;
  if exists (select 1 from public.event_filter_config f, jsonb_array_elements(f.config->'groups') g
             where jsonb_typeof(g->'categories') = 'array' and g->'categories' ? p_id::text) then
    raise exception 'CATEGORY_IN_USE' using detail = 'FILTER_GROUPS';
  end if;
  if exists (select 1 from public.site_settings s
             where coalesce(s.content::text, '') || ' ' || coalesce(s.about::text, '')
                   ~ ('[?&]category=' || v_slug || '([^a-z0-9-]|$)')) then
    raise exception 'CATEGORY_IN_USE' using detail = 'HOMEPAGE_LINKS';
  end if;
  -- With no stored homepage box list the built-in default boxes are shown,
  -- and they link to these categories.
  if v_slug = any (public.homepage_default_category_slugs())
     and not exists (select 1 from public.site_settings s
                     where jsonb_typeof(s.content->'categories'->'boxes') = 'array') then
    raise exception 'CATEGORY_IN_USE' using detail = 'HOMEPAGE_LINKS';
  end if;
  delete from public.event_categories where id = p_id;
end $$;

revoke execute on function public.admin_create_event_category(text, text, text, text) from public, anon;
grant execute on function public.admin_create_event_category(text, text, text, text) to authenticated;
revoke execute on function public.admin_delete_event_category(uuid) from public, anon;
grant execute on function public.admin_delete_event_category(uuid) to authenticated;

-- The stored configuration must still be valid under the new rule.
do $$
declare v_err text;
begin
  select public.event_filter_config_error(config, config) into v_err from public.event_filter_config where id = 1;
  if v_err is not null then
    raise exception 'INVALID_FILTER_CONFIG' using detail = v_err;
  end if;
end $$;
