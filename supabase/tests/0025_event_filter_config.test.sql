-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0025_event_filter_config: seed, PostgreSQL re-validation, events-scope
-- RPC, public read, no client writes, re-runnability. Since 0027 groups
-- reference category UUIDs (pg_temp.cats('slug,slug') builds the array) and
-- validation runs in a trigger instead of a CHECK.
\set ON_ERROR_STOP 1
grant all on all tables in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated;
\ir ../migrations/0027_event_categories.sql
\ir ../migrations/0028_category_link_guards.sql
create or replace function pg_temp.expect_error(p_sql text, p_needle text) returns text
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_ERROR_NOT_RAISED: % (wanted %)', p_sql, p_needle;
exception when others then
  if sqlerrm like 'EXPECTED_ERROR_NOT_RAISED%' or position(p_needle in sqlerrm || ' ' || coalesce(nullif(current_setting('wd.detail', true), ''), '')) = 0 then
    raise exception 'WRONG_ERROR for %: got "%" wanted "%"', p_sql, sqlerrm, p_needle;
  end if;
  return 'PASS error ' || p_needle;
end $$;
create or replace function pg_temp.check(p_ok boolean, p_label text) returns text
language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_label; end if;
  return 'PASS ' || p_label;
end $$;
-- error code returned by the validator for a mutated copy of the default
create or replace function pg_temp.err(p jsonb) returns text language sql as $$ select public.event_filter_config_error(p, null) $$;
create or replace function pg_temp.cats(p_slugs text) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb((select id::text from public.event_categories where slug = s)) order by o), '[]'::jsonb)
  from unnest(string_to_array(p_slugs, ',')) with ordinality u(s, o) $$;
create or replace function pg_temp.def() returns jsonb language sql as $$ select config from public.event_filter_config where id = 1 $$;
create or replace function pg_temp.g(p_id text, p_slug text, p_pos int, p_cats jsonb, p_enabled boolean default true, p_label text default 'Label')
returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'slug', p_slug, 'label', p_label, 'enabled', p_enabled, 'position', p_pos, 'categories', p_cats) $$;

-- ── 1. seed = current bar ───────────────────────────────────────────────────
select pg_temp.check((select pg_temp.def()->>'allLabel') = 'All', '1: All label seeded');
select pg_temp.check((select string_agg(x->>'label', '|' order by (x->>'position')::int) from jsonb_array_elements(pg_temp.def()->'groups') x)
  = 'Workshop|Debate|Poster Presentation|Paper Presentation|Competition|Academic Event|Other', '1: seven tabs in the existing order and wording');
select pg_temp.check((select bool_and(x->>'slug' = x->>'id' and x->'categories' = pg_temp.cats(x->>'id') and (x->>'enabled')::boolean)
  from jsonb_array_elements(pg_temp.def()->'groups') x), '1: each tab = one category (by UUID), slug = category slug (legacy links)');
select pg_temp.check((select array_agg(x->>'id' order by (x->>'position')::int) from jsonb_array_elements(pg_temp.def()->'groups') x)
  = (select array_agg(slug order by position) from public.event_categories), '1: seed covers every seeded category in order');
select pg_temp.check(pg_temp.err(pg_temp.def()) is null, '1: seed passes validation');

-- ── 2. PostgreSQL validation ────────────────────────────────────────────────
select pg_temp.check(pg_temp.err('[]') = 'NOT_OBJECT', '2: non-object');
select pg_temp.check(pg_temp.err('{"allLabel":"All","groups":[],"x":1}') = 'UNKNOWN_KEY', '2: unknown top-level key');
select pg_temp.check(pg_temp.err('{"allLabel":"","groups":[]}') = 'INVALID_ALL_LABEL', '2: empty All label');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', repeat('x', 41), 'groups', '[]'::jsonb)) = 'INVALID_ALL_LABEL', '2: All label > 40');
select pg_temp.check(pg_temp.err('{"allLabel":" All","groups":[]}') = 'INVALID_ALL_LABEL', '2: untrimmed All label');
select pg_temp.check(pg_temp.err('{"allLabel":"All","groups":{}}') = 'GROUPS_NOT_ARRAY', '2: groups not array');
select pg_temp.check(pg_temp.err('{"allLabel":"All","groups":[]}') is null, '2: zero groups (All only) is valid');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups',
  (select jsonb_agg(pg_temp.g('g' || n, 'g' || n, n, pg_temp.cats('workshop'))) from generate_series(1, 8) n))) = 'TOO_MANY_GROUPS', '2: more than seven groups');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups',
  (select jsonb_agg(pg_temp.g('g' || n, 'g' || n, n, pg_temp.cats('workshop'))) from generate_series(1, 7) n))) is null, '2: exactly seven groups ok');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups', jsonb_build_array('"x"'::jsonb))) = 'GROUP_NOT_OBJECT', '2: group not object');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups', jsonb_build_array(pg_temp.g('a', 'a', 1, pg_temp.cats('workshop')) || '{"color":"red"}'))) = 'UNKNOWN_GROUP_KEY', '2: unknown group key');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups', jsonb_build_array(pg_temp.g('A', 'a', 1, pg_temp.cats('workshop'))))) = 'INVALID_GROUP_ID', '2: bad id');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups', jsonb_build_array(pg_temp.g('a', 'Bad Slug', 1, pg_temp.cats('workshop'))))) = 'INVALID_GROUP_SLUG', '2: bad slug');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups', jsonb_build_array(pg_temp.g('a', 'all', 1, pg_temp.cats('workshop'))))) = 'INVALID_GROUP_SLUG', '2: reserved slug "all"');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups', jsonb_build_array(pg_temp.g('a', repeat('a', 41), 1, pg_temp.cats('workshop'))))) = 'INVALID_GROUP_SLUG', '2: slug > 40');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups', jsonb_build_array(pg_temp.g('a', 'a', 1, pg_temp.cats('workshop'), true, '')))) = 'INVALID_GROUP_LABEL', '2: empty label');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups', jsonb_build_array(pg_temp.g('a', 'a', 1, pg_temp.cats('workshop')) || '{"enabled":"yes"}'))) = 'INVALID_GROUP_ENABLED', '2: enabled not boolean');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups', jsonb_build_array(pg_temp.g('a', 'a', 2, pg_temp.cats('workshop'))))) = 'INVALID_GROUP_POSITION', '2: position must match order');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups', jsonb_build_array(pg_temp.g('a', 'a', 1, '[]')))) = 'INVALID_GROUP_CATEGORIES', '2: no categories');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups', jsonb_build_array(pg_temp.g('a', 'a', 1, '["cooking"]')))) = 'UNKNOWN_CATEGORY', '2: non-canonical category');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups', jsonb_build_array(pg_temp.g('a', 'a', 1, '[1]')))) = 'UNKNOWN_CATEGORY', '2: non-string category');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups', jsonb_build_array(pg_temp.g('a', 'a', 1, '["workshop"]')))) = 'UNKNOWN_CATEGORY', '2: slug instead of UUID');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups', jsonb_build_array(pg_temp.g('a', 'a', 1, jsonb_build_array(gen_random_uuid()::text))))) = 'UNKNOWN_CATEGORY', '2: nonexistent UUID');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups', jsonb_build_array(pg_temp.g('a', 'a', 1, pg_temp.cats('paper,paper'))))) = 'DUPLICATE_CATEGORY', '2: duplicate category');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups', jsonb_build_array(pg_temp.g('a', 'a', 1, pg_temp.cats('paper')), pg_temp.g('a', 'b', 2, pg_temp.cats('poster'))))) = 'DUPLICATE_GROUP_ID', '2: duplicate id');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups', jsonb_build_array(pg_temp.g('a', 'x', 1, pg_temp.cats('paper')), pg_temp.g('b', 'x', 2, pg_temp.cats('poster'))))) = 'DUPLICATE_GROUP_SLUG', '2: duplicate slug');
select pg_temp.check(pg_temp.err(jsonb_build_object('allLabel', 'All', 'groups', jsonb_build_array(
  pg_temp.g('pres', 'presentations', 1, pg_temp.cats('poster,paper')), pg_temp.g('res', 'research', 2, pg_temp.cats('paper,academic'), false)))) is null,
  '2: overlapping groups + disabled group are valid');
select pg_temp.expect_error($q$update public.event_filter_config set config = '{"allLabel":"All","groups":"x"}'$q$, 'INVALID_FILTER_CONFIG');

-- ── 3. access ───────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001201', 'ev@x.test'),
  ('00000000-0000-0000-0000-000000001202', 'content@x.test'),
  ('00000000-0000-0000-0000-000000001203', 'part@x.test'),
  ('00000000-0000-0000-0000-000000001204', 'super@x.test');
update public.profiles set approval_status = 'approved';
update public.profiles set role = 'admin', admin_scopes = array['events'] where id = '00000000-0000-0000-0000-000000001201';
update public.profiles set role = 'admin', admin_scopes = array['content'] where id = '00000000-0000-0000-0000-000000001202';
update public.profiles set role = 'admin', is_super_admin = true where id = '00000000-0000-0000-0000-000000001204';
create temp table seed as select pg_temp.def() c;
grant select on seed to anon, authenticated;

set role anon;
select pg_temp.check((select count(*) = 1 from public.event_filter_config), '3: anon can read the config');
select pg_temp.expect_error($q$update public.event_filter_config set config = '{"allLabel":"Hacked","groups":[]}'$q$, 'permission denied');
select pg_temp.expect_error($q$select public.admin_set_event_filter_config('{"allLabel":"Hacked","groups":[]}')$q$, 'permission denied');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001203', false);
select pg_temp.check((select count(*) = 1 from public.event_filter_config), '3: participant can read');
select pg_temp.expect_error($q$update public.event_filter_config set config = '{"allLabel":"Hacked","groups":[]}'$q$, 'permission denied');
select pg_temp.expect_error($q$insert into public.event_filter_config (id, config) values (1, '{"allLabel":"H","groups":[]}')$q$, 'permission denied');
select pg_temp.expect_error($q$delete from public.event_filter_config$q$, 'permission denied');
select pg_temp.expect_error($q$select public.admin_set_event_filter_config('{"allLabel":"Hacked","groups":[]}')$q$, 'FORBIDDEN');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001202', false);
select pg_temp.expect_error($q$select public.admin_set_event_filter_config('{"allLabel":"Hacked","groups":[]}')$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$update public.event_filter_config set config = '{"allLabel":"Hacked","groups":[]}'$q$, 'permission denied');
reset role;
select pg_temp.check((select pg_temp.def() = c from seed), '3: participant/content-admin/anon attempts changed nothing');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001201', false);
select pg_temp.expect_error($q$select public.admin_set_event_filter_config('{"allLabel":"All","groups":[{"id":"a","slug":"a","label":"A","enabled":true,"position":1,"categories":["nope"]}]}')$q$, 'INVALID_FILTER_CONFIG');
select public.admin_set_event_filter_config(jsonb_build_object('allLabel', 'Everything', 'groups', jsonb_build_array(
  pg_temp.g('pres', 'presentations', 1, pg_temp.cats('poster,paper'), true, 'Presentations'),
  pg_temp.g('skills', 'skills', 2, pg_temp.cats('workshop,competition'), true, 'Skills'),
  pg_temp.g('hidden', 'hidden', 3, pg_temp.cats('debate'), false, 'Hidden'))));
reset role;
select pg_temp.check((select config->>'allLabel' = 'Everything' and jsonb_array_length(config->'groups') = 3
                        and updated_by = '00000000-0000-0000-0000-000000001201' from public.event_filter_config), '3: events admin saves through the RPC');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001204', false);
select public.admin_set_event_filter_config((select c from seed));
reset role;
select pg_temp.check((select pg_temp.def() = c from seed), '3: super admin can restore the default');
select pg_temp.check(not has_table_privilege('authenticated', 'public.event_filter_config', 'update')
                 and not has_table_privilege('authenticated', 'public.event_filter_config', 'insert')
                 and not has_table_privilege('authenticated', 'public.event_filter_config', 'delete')
                 and not has_table_privilege('anon', 'public.event_filter_config', 'update')
                 and has_table_privilege('anon', 'public.event_filter_config', 'select')
                 and not has_function_privilege('anon', 'public.admin_set_event_filter_config(jsonb)', 'execute'),
  '3: privileges = public read, RPC-only writes');

-- ── 4. re-running never overwrites a saved config ──────────────────────────
update public.event_filter_config set config = '{"allLabel":"Saved","groups":[]}';
\ir ../migrations/0027_event_categories.sql
\ir ../migrations/0028_category_link_guards.sql
select pg_temp.check((select config->>'allLabel' = 'Saved' from public.event_filter_config), '4: re-run keeps the saved configuration');
select 'ALL 0025 TESTS PASSED';
