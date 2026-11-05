-- ============================================================================
-- WISSENDURST'27 — 0027_event_categories
--
-- Dynamic event categories. The fixed `event_category` enum becomes the
-- `event_categories` table (stable UUID, immutable URL slug, editable label,
-- order, allowlisted icon/tint, archived_at, audit fields).
--
--   * events.category stays the category SLUG (text) with a restricting FK to
--     event_categories(slug). Slugs are immutable, so the slug is as stable as
--     the UUID, every existing event keeps its value byte-for-byte, and old
--     `?category=workshop` links and already-deployed code keep working.
--   * Filter groups (0025) now reference category UUIDs. The stored (already
--     customised) configuration is converted in place — ids, labels, slugs,
--     visibility and positions untouched — and the migration aborts if any
--     reference can't be resolved.
--   * 0025's literal-array CHECK is replaced by a trigger + RPC validation
--     against this table: archived references already in a group are kept,
--     archived categories can't be newly added, unknown ids are rejected.
--   * Lifecycle: create / rename / restyle / reorder / archive / restore and
--     permanent delete of never-used categories, only via events-scope RPCs.
--     `other` (the events.category default) can't be archived or deleted.
--   * Locks: catalogue lock ('wissendurst:event-categories') then the
--     per-category lock ('wissendurst:event-category:<slug>'). Event inserts /
--     category changes take the per-category lock, so assignment never races
--     an archive or delete; the restricting FK is the backstop.
-- Safe to re-run.
-- ============================================================================

-- ── table + seed ────────────────────────────────────────────────────────────
create table if not exists public.event_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique
              check (char_length(slug) between 1 and 40
                     and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and slug <> 'all'),
  label       text not null check (char_length(label) between 1 and 40 and label = btrim(label)),
  position    integer not null check (position >= 1),
  icon_key    text not null check (icon_key = any (array[
                'wrench','messages-square','presentation','file-text','trophy','graduation-cap','stethoscope',
                'book-open','mic','brain','heart-pulse','microscope','flask-conical','pen-tool','users',
                'lightbulb','globe','music','camera','puzzle','award','languages','palette'])),
  color_key   text not null check (color_key = any (array[
                'brand','brand-alt','emerald','cyan','teal','sky','brand-soft',
                'violet','amber','rose','indigo','lime','orange'])),
  archived_at timestamptz,
  archived_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null,
  constraint event_categories_position_key unique (position) deferrable initially deferred,
  constraint event_categories_other_active check (slug <> 'other' or archived_at is null)
);

-- The original seven, in enum order, with their existing look.
insert into public.event_categories (slug, label, position, icon_key, color_key) values
  ('workshop',    'Workshop',            1, 'wrench',          'brand'),
  ('debate',      'Debate',              2, 'messages-square', 'brand-alt'),
  ('poster',      'Poster Presentation', 3, 'presentation',    'emerald'),
  ('paper',       'Paper Presentation',  4, 'file-text',       'cyan'),
  ('competition', 'Competition',         5, 'trophy',          'teal'),
  ('academic',    'Academic Event',      6, 'graduation-cap',  'sky'),
  ('other',       'Other',               7, 'stethoscope',     'brand-soft')
on conflict (slug) do nothing;

alter table public.event_categories enable row level security;
revoke all on public.event_categories from public, anon, authenticated;
grant select on public.event_categories to anon, authenticated;
drop policy if exists event_categories_read on public.event_categories;
create policy event_categories_read on public.event_categories for select using (true);

-- ── locks (fixed order: catalogue, then category) ───────────────────────────
create or replace function public.lock_event_categories()
returns void language sql volatile set search_path = public as $$
  select pg_advisory_xact_lock(hashtext('wissendurst:event-categories'))
$$;
create or replace function public.lock_event_category(p_slug text)
returns void language sql volatile set search_path = public as $$
  select pg_advisory_xact_lock(hashtext('wissendurst:event-category:' || coalesce(p_slug, '')))
$$;
revoke execute on function public.lock_event_categories() from public, anon, authenticated;
revoke execute on function public.lock_event_category(text) from public, anon, authenticated;

-- ── events.category: enum -> slug FK ────────────────────────────────────────
do $$
begin
  if to_regtype('public.event_category') is not null then
    alter table public.events alter column category drop default;
    alter table public.events alter column category type text using category::text;
    alter table public.events alter column category set default 'other';
    drop type public.event_category;
  end if;
  if exists (select 1 from public.events e
             where not exists (select 1 from public.event_categories c where c.slug = e.category)) then
    raise exception 'UNRESOLVED_EVENT_CATEGORY';
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.events'::regclass and conname = 'events_category_fkey') then
    alter table public.events
      add constraint events_category_fkey foreign key (category)
      references public.event_categories(slug) on update restrict on delete restrict;
  end if;
end $$;

-- New/changed assignments: serialise with archive/delete of that category,
-- then require an existing, active category. Unchanged (possibly archived)
-- categories are kept as they are.
create or replace function public.guard_event_category_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_archived timestamptz;
begin
  if tg_op = 'UPDATE' and new.category is not distinct from old.category then
    return new;
  end if;
  perform public.lock_event_category(new.category);
  select archived_at into v_archived from public.event_categories where slug = new.category;
  if not found then raise exception 'CATEGORY_NOT_FOUND'; end if;
  if v_archived is not null then raise exception 'CATEGORY_ARCHIVED'; end if;
  return new;
end $$;
revoke execute on function public.guard_event_category_assignment() from public, anon, authenticated;
drop trigger if exists events_guard_category on public.events;
create trigger events_guard_category
  before insert or update of category on public.events
  for each row execute function public.guard_event_category_assignment();

-- Row rules that hold for every role: slug immutable, `other` protected.
create or replace function public.guard_event_category_row()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.slug = 'other' then raise exception 'CATEGORY_PROTECTED'; end if;
    return old;
  end if;
  if new.slug is distinct from old.slug then raise exception 'CATEGORY_SLUG_IMMUTABLE'; end if;
  if new.slug = 'other' and new.archived_at is not null then raise exception 'CATEGORY_PROTECTED'; end if;
  return new;
end $$;
drop trigger if exists event_categories_guard on public.event_categories;
create trigger event_categories_guard
  before update or delete on public.event_categories
  for each row execute function public.guard_event_category_row();

-- ── filter config: UUID references, table-backed validation ───────────────
alter table public.event_filter_config drop constraint if exists event_filter_config_valid;
drop trigger if exists event_filter_config_enforce on public.event_filter_config;
drop function if exists public.event_filter_config_error(jsonb);

-- Returns null when valid, otherwise a short error code. p_previous is the
-- currently stored config: an archived category is accepted only in a group
-- (same id) that already contained it.
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

-- Convert the stored configuration's slug references to UUIDs (once).
do $$
declare
  v_cfg jsonb;
  v_new jsonb;
  v_bad text;
  v_err text;
  v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  select config into v_cfg from public.event_filter_config where id = 1 for update;
  if v_cfg is null then return; end if;
  if jsonb_typeof(v_cfg->'groups') is distinct from 'array'
     or exists (select 1 from jsonb_array_elements(v_cfg->'groups') g
                where jsonb_typeof(g) <> 'object' or jsonb_typeof(g->'categories') is distinct from 'array') then
    raise exception 'UNRESOLVED_FILTER_CATEGORY' using detail = 'stored filter configuration is malformed';
  end if;
  -- already converted (every reference is a UUID)?
  if not exists (select 1 from jsonb_array_elements(v_cfg->'groups') g, jsonb_array_elements(g->'categories') c
                 where jsonb_typeof(c) <> 'string' or (c #>> '{}') !~ v_uuid) then
    return;
  end if;
  select string_agg(c::text, ', ') into v_bad
    from jsonb_array_elements(v_cfg->'groups') g, jsonb_array_elements(g->'categories') c
   where jsonb_typeof(c) <> 'string'
      or not exists (select 1 from public.event_categories ec where ec.slug = c #>> '{}');
  if v_bad is not null then
    raise exception 'UNRESOLVED_FILTER_CATEGORY' using detail = v_bad;
  end if;

  v_new := jsonb_set(v_cfg, '{groups}', coalesce((
    select jsonb_agg(
             jsonb_set(y.g, '{categories}', (
               select jsonb_agg(to_jsonb(ec.id::text) order by x.ord)
               from jsonb_array_elements_text(y.g->'categories') with ordinality x(s, ord)
               join public.event_categories ec on ec.slug = x.s)) order by y.ord)
    from jsonb_array_elements(v_cfg->'groups') with ordinality y(g, ord)), '[]'::jsonb));

  -- Everything except the category references is untouched, and they map back 1:1.
  if (select jsonb_agg(g - 'categories' order by ord) from jsonb_array_elements(v_new->'groups') with ordinality t(g, ord))
       is distinct from
     (select jsonb_agg(g - 'categories' order by ord) from jsonb_array_elements(v_cfg->'groups') with ordinality t(g, ord))
     or v_new->'allLabel' is distinct from v_cfg->'allLabel'
     or (select jsonb_agg((select jsonb_agg(to_jsonb(ec.slug) order by x.ord)
                           from jsonb_array_elements_text(g->'categories') with ordinality x(s, ord)
                           join public.event_categories ec on ec.id = x.s::uuid) order by t.ord)
         from jsonb_array_elements(v_new->'groups') with ordinality t(g, ord))
       is distinct from
        (select jsonb_agg(g->'categories' order by ord) from jsonb_array_elements(v_cfg->'groups') with ordinality t(g, ord)) then
    raise exception 'FILTER_CONVERSION_MISMATCH';
  end if;
  v_err := public.event_filter_config_error(v_new, v_new);
  if v_err is not null then
    raise exception 'INVALID_FILTER_CONFIG' using detail = v_err;
  end if;
  -- updated_at / updated_by deliberately left as the admin's last save.
  update public.event_filter_config set config = v_new where id = 1;
end $$;

create or replace function public.enforce_event_filter_config()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_err text;
  v_prev jsonb;
begin
  perform public.lock_event_categories();
  -- An upsert fires BEFORE INSERT first: compare with the stored row then too.
  if tg_op = 'UPDATE' then
    v_prev := old.config;
  else
    select config into v_prev from public.event_filter_config where id = new.id;
  end if;
  v_err := public.event_filter_config_error(new.config, v_prev);
  if v_err is not null then
    raise exception 'INVALID_FILTER_CONFIG' using detail = v_err;
  end if;
  return new;
end $$;
revoke execute on function public.enforce_event_filter_config() from public, anon, authenticated;
create trigger event_filter_config_enforce
  before insert or update on public.event_filter_config
  for each row execute function public.enforce_event_filter_config();

-- (re-assert 0025's access model: public read, RPC-only writes)
revoke all on public.event_filter_config from public, anon, authenticated;
grant select on public.event_filter_config to anon, authenticated;

create or replace function public.admin_set_event_filter_config(p_config jsonb)
returns public.event_filter_config
language plpgsql security definer set search_path = public as $$
declare
  v_err text;
  v_prev jsonb;
  v_row public.event_filter_config;
begin
  if not public.has_admin_scope('events') then raise exception 'FORBIDDEN'; end if;
  perform public.lock_event_categories();
  select config into v_prev from public.event_filter_config where id = 1 for update;
  v_err := public.event_filter_config_error(p_config, v_prev);
  if v_err is not null then raise exception 'INVALID_FILTER_CONFIG' using detail = v_err; end if;
  insert into public.event_filter_config (id, config, updated_at, updated_by)
  values (1, p_config, now(), auth.uid())
  on conflict (id) do update set config = excluded.config, updated_at = now(), updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.admin_set_event_filter_config(jsonb) from public, anon;
grant execute on function public.admin_set_event_filter_config(jsonb) to authenticated;

-- ── category RPCs (events scope) ────────────────────────────────────────────
create or replace function public.event_category_check_fields(p_label text, p_icon_key text, p_color_key text)
returns void language plpgsql immutable set search_path = public as $$
begin
  if p_label is null or char_length(p_label) not between 1 and 40 or p_label <> btrim(p_label) then
    raise exception 'INVALID_CATEGORY_LABEL';
  end if;
  if p_icon_key is null or not (p_icon_key = any (array[
       'wrench','messages-square','presentation','file-text','trophy','graduation-cap','stethoscope',
       'book-open','mic','brain','heart-pulse','microscope','flask-conical','pen-tool','users',
       'lightbulb','globe','music','camera','puzzle','award','languages','palette'])) then
    raise exception 'INVALID_CATEGORY_ICON';
  end if;
  if p_color_key is null or not (p_color_key = any (array[
       'brand','brand-alt','emerald','cyan','teal','sky','brand-soft',
       'violet','amber','rose','indigo','lime','orange'])) then
    raise exception 'INVALID_CATEGORY_COLOR';
  end if;
end $$;

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

create or replace function public.admin_update_event_category(
  p_id uuid, p_label text, p_icon_key text, p_color_key text)
returns public.event_categories
language plpgsql security definer set search_path = public as $$
declare
  v_label text := btrim(coalesce(p_label, ''));
  v_slug text;
  v_row public.event_categories;
begin
  if not public.has_admin_scope('events') then raise exception 'FORBIDDEN'; end if;
  perform public.event_category_check_fields(v_label, p_icon_key, p_color_key);
  perform public.lock_event_categories();
  select slug into v_slug from public.event_categories where id = p_id;
  if not found then raise exception 'CATEGORY_NOT_FOUND'; end if;
  perform public.lock_event_category(v_slug);
  if exists (select 1 from public.event_categories where lower(label) = lower(v_label) and id <> p_id) then
    raise exception 'CATEGORY_LABEL_TAKEN';
  end if;
  update public.event_categories
     set label = v_label, icon_key = p_icon_key, color_key = p_color_key,
         updated_at = now(), updated_by = auth.uid()
   where id = p_id
  returning * into v_row;
  return v_row;
end $$;

-- p_ids must list every category exactly once, in the new order.
create or replace function public.admin_reorder_event_categories(p_ids uuid[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_admin_scope('events') then raise exception 'FORBIDDEN'; end if;
  perform public.lock_event_categories();
  if p_ids is null
     or cardinality(p_ids) <> (select count(*) from public.event_categories)
     or (select count(distinct x) from unnest(p_ids) x) <> cardinality(p_ids)
     or exists (select 1 from unnest(p_ids) x where not exists (select 1 from public.event_categories where id = x)) then
    raise exception 'INVALID_CATEGORY_ORDER';
  end if;
  update public.event_categories c
     set position = o.ord, updated_at = now(), updated_by = auth.uid()
    from unnest(p_ids) with ordinality o(id, ord)
   where c.id = o.id and c.position is distinct from o.ord;
end $$;

create or replace function public.admin_set_event_category_archived(p_id uuid, p_archived boolean)
returns public.event_categories
language plpgsql security definer set search_path = public as $$
declare
  v_row public.event_categories;
begin
  if not public.has_admin_scope('events') then raise exception 'FORBIDDEN'; end if;
  if p_archived is null then raise exception 'INVALID_REQUEST'; end if;
  perform public.lock_event_categories();
  select * into v_row from public.event_categories where id = p_id;
  if not found then raise exception 'CATEGORY_NOT_FOUND'; end if;
  perform public.lock_event_category(v_row.slug);
  select * into v_row from public.event_categories where id = p_id for update;
  if v_row.slug = 'other' and p_archived then raise exception 'CATEGORY_PROTECTED'; end if;
  if p_archived = (v_row.archived_at is not null) then return v_row; end if;  -- no-op
  -- Never touches events: they keep their (now archived) category.
  update public.event_categories
     set archived_at = case when p_archived then now() end,
         archived_by = case when p_archived then auth.uid() end,
         updated_at = now(), updated_by = auth.uid()
   where id = p_id
  returning * into v_row;
  return v_row;
end $$;

-- Permanent delete: only a category no event, filter group or stored site
-- content link (?category=<slug>) uses. Re-checked under the locks.
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
  delete from public.event_categories where id = p_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_create_event_category(text, text, text, text)',
    'public.admin_update_event_category(uuid, text, text, text)',
    'public.admin_reorder_event_categories(uuid[])',
    'public.admin_set_event_category_archived(uuid, boolean)',
    'public.admin_delete_event_category(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke execute on function public.event_category_check_fields(text, text, text) from public, anon, authenticated;
