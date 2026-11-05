-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0028_category_link_guards: category slug vs filter-tab slug collisions,
-- built-in homepage box links protect categories from permanent deletion.
\set ON_ERROR_STOP 1
grant all on all tables in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated;
\ir ../migrations/0028_category_link_guards.sql

create or replace function pg_temp.expect_error(p_sql text, p_needle text) returns text
language plpgsql as $$
declare v_detail text;
begin
  execute p_sql;
  raise exception 'EXPECTED_ERROR_NOT_RAISED: % (wanted %)', p_sql, p_needle;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  if sqlerrm like 'EXPECTED_ERROR_NOT_RAISED%'
     or position(p_needle in sqlerrm || ' ' || coalesce(v_detail, '')) = 0 then
    raise exception 'WRONG_ERROR for %: got "%" (%) wanted "%"', p_sql, sqlerrm, v_detail, p_needle;
  end if;
  return 'PASS error ' || p_needle;
end $$;
create or replace function pg_temp.check(p_ok boolean, p_label text) returns text
language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_label; end if;
  return 'PASS ' || p_label;
end $$;
create or replace function pg_temp.cid(p_slug text) returns text
language sql stable security definer as $$ select id::text from public.event_categories where slug = p_slug $$;
create or replace function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p, false) $$;
create or replace function pg_temp.g(p_id text, p_slug text, p_pos int, p_cats text[]) returns jsonb language sql stable as $$
  select jsonb_build_object('id', p_id, 'slug', p_slug, 'label', initcap(p_id), 'enabled', true, 'position', p_pos,
    'categories', (select jsonb_agg(to_jsonb(pg_temp.cid(c)) order by o) from unnest(p_cats) with ordinality u(c, o))) $$;
create or replace function pg_temp.cfg(variadic p_groups jsonb[]) returns jsonb language sql as $$
  select jsonb_build_object('allLabel', 'All', 'groups', coalesce(to_jsonb(p_groups), '[]'::jsonb)) $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000001701', 'ev@x.test');
update public.profiles set approval_status = 'approved', role = 'admin', admin_scopes = array['events']
 where id = '00000000-0000-0000-0000-000000001701';

-- the LIVE shape: tab "workshop" shows Poster Presentation (pre-existing collision)
alter table public.event_filter_config disable trigger event_filter_config_enforce;
update public.event_filter_config set config = pg_temp.cfg(
  pg_temp.g('workshop', 'quizzes', 1, array['workshop']),
  pg_temp.g('poster', 'workshop', 2, array['poster']),
  pg_temp.g('other', 'other', 3, array['other']));
alter table public.event_filter_config enable trigger event_filter_config_enforce;
create temp table live as select config c from public.event_filter_config;
grant select on live to authenticated;

-- ── 1. tab slugs vs category slugs ──────────────────────────────────────────
select pg_temp.check(public.event_filter_config_error((select c from live), (select c from live)) is null,
  '1: the live configuration (pre-existing collision) stays valid');
select pg_temp.check(public.event_filter_config_error((select c from live), null) = 'GROUP_SLUG_SHADOWS_CATEGORY',
  '1: the same collision is refused when it is new');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001701');
-- re-saving the live config (labels changed) keeps the grandfathered slug
select public.admin_set_event_filter_config(jsonb_set((select c from live), '{groups,1,label}', '"Workshops!"'));
-- a tab can't newly take a category's slug ...
select pg_temp.expect_error(format($q$select public.admin_set_event_filter_config(%L)$q$, pg_temp.cfg(
  pg_temp.g('workshop', 'debate', 1, array['workshop']),
  pg_temp.g('poster', 'workshop', 2, array['poster']),
  pg_temp.g('other', 'other', 3, array['other']))), 'GROUP_SLUG_SHADOWS_CATEGORY');
-- ... nor a brand-new tab (different id) reuse it
select pg_temp.expect_error(format($q$select public.admin_set_event_filter_config(%L)$q$, pg_temp.cfg(
  pg_temp.g('workshop', 'quizzes', 1, array['workshop']),
  pg_temp.g('poster', 'workshop', 2, array['poster']),
  pg_temp.g('other', 'other', 3, array['other']),
  pg_temp.g('papers', 'paper', 4, array['paper', 'poster']))), 'GROUP_SLUG_SHADOWS_CATEGORY');
-- a tab showing exactly that one category may use its slug (no shadowing)
select public.admin_set_event_filter_config(pg_temp.cfg(
  pg_temp.g('workshop', 'quizzes', 1, array['workshop']),
  pg_temp.g('poster', 'workshop', 2, array['poster']),
  pg_temp.g('other', 'other', 3, array['other']),
  pg_temp.g('papers', 'paper', 4, array['paper'])));
-- once the grandfathered slug is changed, it can't come back
select public.admin_set_event_filter_config(pg_temp.cfg(
  pg_temp.g('workshop', 'quizzes', 1, array['workshop']),
  pg_temp.g('poster', 'posters', 2, array['poster']),
  pg_temp.g('other', 'other', 3, array['other'])));
select pg_temp.expect_error(format($q$select public.admin_set_event_filter_config(%L)$q$, (select c from live)), 'GROUP_SLUG_SHADOWS_CATEGORY');
-- new categories can't take a tab's slug (enabled or not)
select pg_temp.expect_error($q$select public.admin_create_event_category('quizzes', 'Quizzes', 'puzzle', 'violet')$q$, 'CATEGORY_SLUG_USED_BY_FILTER_TAB');
select pg_temp.expect_error($q$select public.admin_create_event_category('posters', 'Posters', 'puzzle', 'violet')$q$, 'CATEGORY_SLUG_USED_BY_FILTER_TAB');
select public.admin_create_event_category('quiz-night', 'Quiz night', 'puzzle', 'violet');
reset role;
select pg_temp.check((select count(*) = 8 from public.event_categories)
                 and (select config->'groups'->1->>'slug' = 'posters' from public.event_filter_config),
  '1: refused saves/creates changed nothing');
-- direct writes are held to the same rule by the trigger
select pg_temp.expect_error(format($q$update public.event_filter_config set config = %L$q$, pg_temp.cfg(
  pg_temp.g('x', 'debate', 1, array['poster']))), 'GROUP_SLUG_SHADOWS_CATEGORY');

-- ── 2. built-in homepage boxes protect their categories ────────────────────
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001701');
select public.admin_create_event_category('spare', 'Spare', 'mic', 'lime');
select public.admin_set_event_filter_config(pg_temp.cfg(pg_temp.g('ws', 'ws', 1, array['workshop'])));
reset role;
delete from public.site_settings;                                   -- nothing stored -> defaults shown
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001701');
select pg_temp.expect_error($q$select public.admin_delete_event_category((select id from public.event_categories where slug = 'debate'))$q$, 'HOMEPAGE_LINKS');
select pg_temp.expect_error($q$select public.admin_delete_event_category((select id from public.event_categories where slug = 'academic'))$q$, 'HOMEPAGE_LINKS');
reset role;
insert into public.site_settings (id, content) values (1, '{"hero":{}}');      -- stored, but no box list -> defaults
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001701');
select pg_temp.expect_error($q$select public.admin_delete_event_category((select id from public.event_categories where slug = 'debate'))$q$, 'HOMEPAGE_LINKS');
reset role;
update public.site_settings set content = '{"categories":{"boxes":"oops"}}';  -- malformed list -> defaults
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001701');
select pg_temp.expect_error($q$select public.admin_delete_event_category((select id from public.event_categories where slug = 'debate'))$q$, 'HOMEPAGE_LINKS');
select public.admin_delete_event_category((select id from public.event_categories where slug = 'spare'));  -- not a default box link
reset role;
update public.site_settings set content = '{"categories":{"boxes":[]}}';      -- stored (empty) list: defaults not shown
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001701');
select public.admin_delete_event_category((select id from public.event_categories where slug = 'debate'));
reset role;
select pg_temp.check((select count(*) = 0 from public.event_categories where slug in ('debate', 'spare'))
                 and (select count(*) = 1 from public.event_categories where slug = 'academic'),
  '2: defaults protect their categories only while they are shown');
select pg_temp.check(not has_function_privilege('authenticated', 'public.homepage_default_category_slugs()', 'execute')
                 and not has_function_privilege('anon', 'public.admin_delete_event_category(uuid)', 'execute'),
  '2: helper and RPC grants');

-- ── 3. re-run is safe ──────────────────────────────────────────────────────
\ir ../migrations/0028_category_link_guards.sql
select pg_temp.check(true, '3: re-run ok');
select 'ALL 0028 TESTS PASSED';
