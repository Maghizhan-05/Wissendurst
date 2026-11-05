-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0027_event_categories: enum -> table backfill, category lifecycle RPCs,
-- protected `other`, slug immutability, allowlists, archived-category rules
-- for events and filter groups, deletion protection, RLS / RPC authorization.
\set ON_ERROR_STOP 1
grant all on all tables in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated;
\ir ../migrations/0027_event_categories.sql
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
create or replace function pg_temp.cat(p_slug text) returns public.event_categories
language sql stable security definer as $$ select * from public.event_categories where slug = p_slug $$;
create or replace function pg_temp.cid(p_slug text) returns text
language sql stable security definer as $$ select id::text from public.event_categories where slug = p_slug $$;
create or replace function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p, false) $$;
create or replace function pg_temp.cfg_with(p_groups jsonb) returns jsonb language sql as $$
  select jsonb_build_object('allLabel', 'All', 'groups', p_groups) $$;
create or replace function pg_temp.g(p_id text, p_pos int, p_cats jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'slug', p_id, 'label', initcap(p_id), 'enabled', true, 'position', p_pos, 'categories', p_cats) $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001501', 'ev@x.test'),
  ('00000000-0000-0000-0000-000000001502', 'content@x.test'),
  ('00000000-0000-0000-0000-000000001503', 'part@x.test');
update public.profiles set approval_status = 'approved';
update public.profiles set role = 'admin', admin_scopes = array['events'] where id = '00000000-0000-0000-0000-000000001501';
update public.profiles set role = 'admin', admin_scopes = array['content'] where id = '00000000-0000-0000-0000-000000001502';

-- ── 1. enum -> table ────────────────────────────────────────────────────────
select pg_temp.check(to_regtype('public.event_category') is null, '1: event_category enum dropped');
select pg_temp.check((select data_type = 'text' and column_default like '''other''%' from information_schema.columns
                      where table_name = 'events' and column_name = 'category'), '1: events.category is text, default other');
select pg_temp.check((select confdeltype = 'r' and confupdtype = 'r' from pg_constraint where conname = 'events_category_fkey'),
  '1: restricting FK events.category -> event_categories(slug)');
select pg_temp.check((select string_agg(slug || ':' || label || ':' || icon_key || ':' || color_key, '|' order by position)
                      from public.event_categories) =
  'workshop:Workshop:wrench:brand|debate:Debate:messages-square:brand-alt|poster:Poster Presentation:presentation:emerald|paper:Paper Presentation:file-text:cyan|competition:Competition:trophy:teal|academic:Academic Event:graduation-cap:sky|other:Other:stethoscope:brand-soft',
  '1: original seven seeded in order with their look');
insert into public.events (slug, title, category, registration_open, is_live) values
  ('e-ws', 'WS', 'workshop', true, true), ('e-paper', 'Paper', 'paper', true, true), ('e-default', 'Default', default, true, true);
select pg_temp.check((select string_agg(category, ',' order by slug) from public.events) = 'other,paper,workshop', '1: events keep slug categories; default other');

-- ── 2. authorization ────────────────────────────────────────────────────────
set role anon;
select pg_temp.check((select count(*) = 7 from public.event_categories), '2: anon can read categories');
select pg_temp.expect_error($q$insert into public.event_categories (slug, label, position, icon_key, color_key) values ('x', 'X', 99, 'mic', 'rose')$q$, 'permission denied');
select pg_temp.expect_error($q$select public.admin_create_event_category('x', 'X', 'mic', 'rose')$q$, 'permission denied');
reset role;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001503');
select pg_temp.expect_error($q$insert into public.event_categories (slug, label, position, icon_key, color_key) values ('x', 'X', 99, 'mic', 'rose')$q$, 'permission denied');
select pg_temp.expect_error($q$update public.event_categories set label = 'Hacked'$q$, 'permission denied');
select pg_temp.expect_error($q$delete from public.event_categories where slug = 'debate'$q$, 'permission denied');
select pg_temp.expect_error($q$select public.admin_create_event_category('x', 'X', 'mic', 'rose')$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$select public.admin_set_event_category_archived((select id from public.event_categories where slug = 'debate'), true)$q$, 'FORBIDDEN');
select pg_temp.as_user('00000000-0000-0000-0000-000000001502');
select pg_temp.expect_error($q$select public.admin_update_event_category((select id from public.event_categories where slug = 'debate'), 'Hacked', 'mic', 'rose')$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$select public.admin_delete_event_category((select id from public.event_categories where slug = 'debate'))$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$select public.admin_reorder_event_categories(array(select id from public.event_categories order by position desc))$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$select public.lock_event_categories()$q$, 'permission denied');
reset role;
select pg_temp.check((select count(*) = 7 and bool_and(label <> 'Hacked') from public.event_categories), '2: unauthorized attempts changed nothing');

-- ── 3. create / validate ────────────────────────────────────────────────────
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001501');
select public.admin_create_event_category('quiz', 'Quiz', 'puzzle', 'violet');
select pg_temp.expect_error($q$select public.admin_create_event_category('quiz', 'Quiz 2', 'mic', 'rose')$q$, 'CATEGORY_SLUG_TAKEN');
select pg_temp.expect_error($q$select public.admin_create_event_category('quiz-2', 'QUIZ', 'mic', 'rose')$q$, 'CATEGORY_LABEL_TAKEN');
select pg_temp.expect_error($q$select public.admin_create_event_category('Quiz', 'Q', 'mic', 'rose')$q$, 'INVALID_CATEGORY_SLUG');
select pg_temp.expect_error($q$select public.admin_create_event_category('all', 'Q', 'mic', 'rose')$q$, 'INVALID_CATEGORY_SLUG');
select pg_temp.expect_error($q$select public.admin_create_event_category('a--b', 'Q', 'mic', 'rose')$q$, 'INVALID_CATEGORY_SLUG');
select pg_temp.expect_error($q$select public.admin_create_event_category(repeat('a', 41), 'Q', 'mic', 'rose')$q$, 'INVALID_CATEGORY_SLUG');
select pg_temp.expect_error($q$select public.admin_create_event_category('', 'Q', 'mic', 'rose')$q$, 'INVALID_CATEGORY_SLUG');
select pg_temp.expect_error($q$select public.admin_create_event_category('q', '', 'mic', 'rose')$q$, 'INVALID_CATEGORY_LABEL');
select pg_temp.expect_error($q$select public.admin_create_event_category('q', repeat('x', 41), 'mic', 'rose')$q$, 'INVALID_CATEGORY_LABEL');
select pg_temp.expect_error($q$select public.admin_create_event_category('q', 'Q', 'skull', 'rose')$q$, 'INVALID_CATEGORY_ICON');
select pg_temp.expect_error($q$select public.admin_create_event_category('q', 'Q', 'mic', 'red; background:none')$q$, 'INVALID_CATEGORY_COLOR');
reset role;
select pg_temp.check((pg_temp.cat('quiz')).position = 8 and (pg_temp.cat('quiz')).created_by = '00000000-0000-0000-0000-000000001501'
                 and (select count(*) = 8 from public.event_categories), '3: create appends with audit; invalid creates added nothing');
select pg_temp.expect_error($q$update public.event_categories set icon_key = 'skull' where slug = 'quiz'$q$, 'violates check constraint');
select pg_temp.expect_error($q$update public.event_categories set color_key = 'javascript:alert(1)' where slug = 'quiz'$q$, 'violates check constraint');

-- ── 4. rename / restyle / slug immutable / reorder ─────────────────────────
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001501');
select public.admin_update_event_category((pg_temp.cat('quiz')).id, 'Quizzes', 'brain', 'amber');
select public.admin_update_event_category((pg_temp.cat('other')).id, 'Other Events', 'award', 'rose');   -- other: editable look
select pg_temp.expect_error($q$select public.admin_update_event_category((select id from public.event_categories where slug = 'quiz'), 'Debate', 'brain', 'amber')$q$, 'CATEGORY_LABEL_TAKEN');
select pg_temp.expect_error($q$select public.admin_update_event_category(gen_random_uuid(), 'X', 'brain', 'amber')$q$, 'CATEGORY_NOT_FOUND');
select public.admin_reorder_event_categories(array(select id from public.event_categories order by (slug = 'quiz') desc, position));
select pg_temp.expect_error($q$select public.admin_reorder_event_categories(array(select id from public.event_categories where slug <> 'quiz'))$q$, 'INVALID_CATEGORY_ORDER');
select pg_temp.expect_error($q$select public.admin_reorder_event_categories(array(select id from public.event_categories) || (select id from public.event_categories where slug = 'quiz'))$q$, 'INVALID_CATEGORY_ORDER');
select pg_temp.expect_error($q$select public.admin_reorder_event_categories(array(select id from public.event_categories where slug <> 'quiz') || gen_random_uuid())$q$, 'INVALID_CATEGORY_ORDER');
reset role;
select pg_temp.check((pg_temp.cat('quiz')).label = 'Quizzes' and (pg_temp.cat('quiz')).icon_key = 'brain' and (pg_temp.cat('quiz')).color_key = 'amber'
                 and (pg_temp.cat('other')).label = 'Other Events', '4: rename + restyle (incl. other)');
select pg_temp.check((select string_agg(slug, ',' order by position) from public.event_categories) = 'quiz,workshop,debate,poster,paper,competition,academic,other',
  '4: reorder applied; invalid orders changed nothing');
select pg_temp.expect_error($q$update public.event_categories set slug = 'quizzes' where slug = 'quiz'$q$, 'CATEGORY_SLUG_IMMUTABLE');
select pg_temp.expect_error($q$update public.event_categories set slug = 'workshops' where slug = 'workshop'$q$, 'CATEGORY_SLUG_IMMUTABLE');

-- ── 5. archive / restore, protected other ──────────────────────────────────
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001501');
select public.admin_set_event_category_archived((pg_temp.cat('paper')).id, true);
select public.admin_set_event_category_archived((pg_temp.cat('paper')).id, true);                 -- idempotent
select pg_temp.expect_error($q$select public.admin_set_event_category_archived((select id from public.event_categories where slug = 'other'), true)$q$, 'CATEGORY_PROTECTED');
select pg_temp.expect_error($q$select public.admin_delete_event_category((select id from public.event_categories where slug = 'other'))$q$, 'CATEGORY_PROTECTED');
select pg_temp.expect_error($q$select public.admin_set_event_category_archived((select id from public.event_categories where slug = 'paper'), null)$q$, 'INVALID_REQUEST');
reset role;
select pg_temp.expect_error($q$delete from public.event_categories where slug = 'other'$q$, 'CATEGORY_PROTECTED');
select pg_temp.expect_error($q$update public.event_categories set archived_at = now() where slug = 'other'$q$, 'CATEGORY_PROTECTED');
select pg_temp.check((pg_temp.cat('paper')).archived_at is not null and (pg_temp.cat('paper')).archived_by = '00000000-0000-0000-0000-000000001501'
                 and (select category = 'paper' from public.events where slug = 'e-paper'), '5: archive never reassigns the event');

-- ── 6. events and archived categories ──────────────────────────────────────
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001501');
update public.events set title = 'Paper renamed' where slug = 'e-paper';                         -- keeps archived category
update public.events set category = 'paper', title = 'Paper again' where slug = 'e-paper';      -- unchanged value ok
select pg_temp.expect_error($q$insert into public.events (slug, title, category) values ('e-new', 'New', 'paper')$q$, 'CATEGORY_ARCHIVED');
select pg_temp.expect_error($q$update public.events set category = 'paper' where slug = 'e-ws'$q$, 'CATEGORY_ARCHIVED');
select pg_temp.expect_error($q$insert into public.events (slug, title, category) values ('e-new', 'New', 'cooking')$q$, 'CATEGORY_NOT_FOUND');
insert into public.events (slug, title, category) values ('e-quiz', 'Quiz night', 'quiz');
reset role;
select pg_temp.check((select category = 'paper' and title = 'Paper again' from public.events where slug = 'e-paper'), '6: existing event retains archived category');
select pg_temp.expect_error($q$insert into public.events (slug, title, category) values ('e-new2', 'New', 'paper')$q$, 'CATEGORY_ARCHIVED');  -- privileged roles too
set role anon;
select pg_temp.check((select label = 'Paper Presentation' from public.event_categories where slug = 'paper'), '6: archived category still readable (old URLs + badges resolve)');
reset role;

-- ── 7. filter groups: active / archived / nonexistent ──────────────────────
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001501');
select public.admin_set_event_filter_config(pg_temp.cfg_with(jsonb_build_array(
  pg_temp.g('pres', 1, jsonb_build_array(pg_temp.cid('poster'))),
  pg_temp.g('quizzes', 2, jsonb_build_array(pg_temp.cid('quiz'))))));
select pg_temp.expect_error(format($q$select public.admin_set_event_filter_config(%L)$q$, pg_temp.cfg_with(jsonb_build_array(
  pg_temp.g('pres', 1, jsonb_build_array(pg_temp.cid('poster'), pg_temp.cid('paper')))))), 'ARCHIVED_CATEGORY');
select pg_temp.expect_error(format($q$select public.admin_set_event_filter_config(%L)$q$, pg_temp.cfg_with(jsonb_build_array(
  pg_temp.g('pres', 1, jsonb_build_array(gen_random_uuid()::text))))), 'UNKNOWN_CATEGORY');
-- restore, reference it, archive again: the existing reference is accepted on re-save, and removable
select public.admin_set_event_category_archived((pg_temp.cat('paper')).id, false);
select public.admin_set_event_filter_config(pg_temp.cfg_with(jsonb_build_array(
  pg_temp.g('pres', 1, jsonb_build_array(pg_temp.cid('poster'), pg_temp.cid('paper'))),
  pg_temp.g('quizzes', 2, jsonb_build_array(pg_temp.cid('quiz'))))));
select public.admin_set_event_category_archived((pg_temp.cat('paper')).id, true);
select public.admin_set_event_filter_config(pg_temp.cfg_with(jsonb_build_array(
  pg_temp.g('pres', 1, jsonb_build_array(pg_temp.cid('poster'), pg_temp.cid('paper'))),
  jsonb_set(pg_temp.g('quizzes', 2, jsonb_build_array(pg_temp.cid('quiz'))), '{label}', '"Quiz time"'))));
-- ... but not moved into a different group
select pg_temp.expect_error(format($q$select public.admin_set_event_filter_config(%L)$q$, pg_temp.cfg_with(jsonb_build_array(
  pg_temp.g('pres', 1, jsonb_build_array(pg_temp.cid('poster'), pg_temp.cid('paper'))),
  pg_temp.g('quizzes', 2, jsonb_build_array(pg_temp.cid('quiz'), pg_temp.cid('paper')))))), 'ARCHIVED_CATEGORY');
reset role;
select pg_temp.check((select config->'groups'->0->'categories' = jsonb_build_array(pg_temp.cid('poster'), pg_temp.cid('paper'))
                         and config->'groups'->1->>'label' = 'Quiz time' from public.event_filter_config),
  '7: archived reference kept on re-save; can''t be newly added');
-- direct writes are validated by the trigger too
select pg_temp.expect_error(format($q$update public.event_filter_config set config = %L$q$, pg_temp.cfg_with(jsonb_build_array(
  pg_temp.g('x', 1, jsonb_build_array(pg_temp.cid('paper')))))), 'ARCHIVED_CATEGORY');
select pg_temp.expect_error($q$update public.event_filter_config set config = '{"allLabel":"All","groups":[{"id":"a","slug":"a","label":"A","enabled":true,"position":1,"categories":["workshop"]}]}'$q$, 'UNKNOWN_CATEGORY');

-- ── 8. permanent delete only when unused ───────────────────────────────────
-- site_settings row for homepage links (shape irrelevant to the check)
insert into public.site_settings (id, content) values (1, '{"categories":{"boxes":[{"href":"/events?category=linked"},{"href":"/events?x=1&category=linked#top"}]}}')
on conflict (id) do update set content = excluded.content;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001501');
select public.admin_create_event_category('unused', 'Unused', 'mic', 'lime');
select public.admin_create_event_category('linked', 'Linked', 'mic', 'lime');
select public.admin_create_event_category('link', 'Link', 'mic', 'lime');           -- prefix of a linked slug
select public.admin_create_event_category('grouped', 'Grouped', 'mic', 'lime');
select public.admin_set_event_filter_config(pg_temp.cfg_with(jsonb_build_array(
  pg_temp.g('pres', 1, jsonb_build_array(pg_temp.cid('poster'), pg_temp.cid('paper'))),
  pg_temp.g('quizzes', 2, jsonb_build_array(pg_temp.cid('quiz'), pg_temp.cid('grouped'))))));
select public.admin_delete_event_category((pg_temp.cat('unused')).id);
select public.admin_delete_event_category((pg_temp.cat('link')).id);
select pg_temp.expect_error($q$select public.admin_delete_event_category((select id from public.event_categories where slug = 'paper'))$q$, 'EVENTS');
select pg_temp.expect_error($q$select public.admin_delete_event_category((select id from public.event_categories where slug = 'quiz'))$q$, 'EVENTS');
select pg_temp.expect_error($q$select public.admin_delete_event_category((select id from public.event_categories where slug = 'grouped'))$q$, 'FILTER_GROUPS');
select pg_temp.expect_error($q$select public.admin_delete_event_category((select id from public.event_categories where slug = 'linked'))$q$, 'HOMEPAGE_LINKS');
select pg_temp.expect_error($q$select public.admin_delete_event_category(gen_random_uuid())$q$, 'CATEGORY_NOT_FOUND');
reset role;
select pg_temp.check((pg_temp.cat('unused')).id is null and (pg_temp.cat('link')).id is null, '8: unused categories deleted (no prefix false-positive)');
select pg_temp.check((pg_temp.cat('paper')).id is not null and (pg_temp.cat('quiz')).id is not null and (pg_temp.cat('grouped')).id is not null
                 and (pg_temp.cat('linked')).id is not null, '8: refused deletes rolled back completely');
-- a category used only by an ARCHIVED event is still in use
update public.events set category = 'linked' where slug = 'e-default';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001501');
select public.admin_set_event_archived((select id from public.events where slug = 'e-default'), true);
reset role;
update public.site_settings set content = '{}' where id = 1;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001501');
select pg_temp.expect_error($q$select public.admin_delete_event_category((select id from public.event_categories where slug = 'linked'))$q$, 'EVENTS');
reset role;
-- the restricting FK is the backstop even for privileged deletes
select pg_temp.expect_error($q$delete from public.event_categories where slug = 'workshop'$q$, 'violates foreign key constraint');

-- ── 9. capacity (50) ────────────────────────────────────────────────────────
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001501');
select count(public.admin_create_event_category('c' || n, 'Cat ' || n, 'mic', 'lime'))
  from generate_series(1, 50 - (select count(*) from public.event_categories)::int) n;
select pg_temp.expect_error($q$select public.admin_create_event_category('one-too-many', 'One too many', 'mic', 'lime')$q$, 'TOO_MANY_CATEGORIES');
reset role;
select pg_temp.check((select count(*) = 50 from public.event_categories), '9: at most 50 categories');

-- ── 10. re-run keeps everything ─────────────────────────────────────────────
create temp table before_rerun as
  select (select jsonb_agg(to_jsonb(c) order by id) from public.event_categories c) cats,
         (select config from public.event_filter_config) cfg,
         (select string_agg(slug || ':' || category, ',' order by slug) from public.events) evs;
\ir ../migrations/0027_event_categories.sql
\ir ../migrations/0028_category_link_guards.sql
select pg_temp.check((select cats = (select jsonb_agg(to_jsonb(c) order by id) from public.event_categories c)
                        and cfg = (select config from public.event_filter_config)
                        and evs = (select string_agg(slug || ':' || category, ',' order by slug) from public.events)
                      from before_rerun), '10: re-run changes nothing');
select 'ALL 0027 TESTS PASSED';
