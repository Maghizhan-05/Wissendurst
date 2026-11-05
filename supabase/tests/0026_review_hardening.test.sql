-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0026_review_hardening: archive/delete only through the RPCs, archived
-- hierarchy frozen, restore-after-lock semantics, protected default event
-- UPI enforced against General Registration.
\set ON_ERROR_STOP 1
grant all on all tables in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated;
\ir ../migrations/0026_review_hardening.sql

create or replace function pg_temp.expect_error(p_sql text, p_needle text) returns text
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_ERROR_NOT_RAISED: % (wanted %)', p_sql, p_needle;
exception when others then
  if sqlerrm like 'EXPECTED_ERROR_NOT_RAISED%' or position(p_needle in sqlerrm) = 0 then
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
create or replace function pg_temp.ev(p_slug text) returns public.events language sql stable security definer as $$
  select * from public.events where slug = p_slug $$;
create or replace function pg_temp.as_user(p_n text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_n, false) $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001301', 'ev@x.test'),
  ('00000000-0000-0000-0000-000000001302', 'pay@x.test'),
  ('00000000-0000-0000-0000-000000001303', 'part@x.test');
update public.profiles set approval_status = 'approved';
update public.profiles set role = 'admin', admin_scopes = array['events'] where id = '00000000-0000-0000-0000-000000001301';
update public.profiles set role = 'admin', admin_scopes = array['payments'] where id = '00000000-0000-0000-0000-000000001302';
insert into public.events (slug, title, registration_open, is_live) values ('root', 'Root', true, true), ('solo', 'Solo', true, true);
insert into public.events (slug, title, registration_open, is_live, parent_event_id)
  values ('kid', 'Kid', true, true, (select id from public.events where slug = 'root'));

-- ── 1. direct archive/restore/delete by an events admin is refused ─────────
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001301');
select pg_temp.expect_error($q$update public.events set archived_at = now() where slug = 'root'$q$, 'EVENT_ARCHIVE_VIA_RPC');
select pg_temp.expect_error($q$update public.events set archived_by = auth.uid() where slug = 'root'$q$, 'EVENT_ARCHIVE_VIA_RPC');
select pg_temp.expect_error($q$insert into public.events (slug, title, archived_at) values ('pre', 'Pre', now())$q$, 'EVENT_ARCHIVE_VIA_RPC');
select pg_temp.expect_error($q$delete from public.events where slug = 'solo'$q$, 'EVENT_DELETE_VIA_RPC');
update public.events set title = 'Root renamed' where slug = 'root';           -- ordinary edits still work
reset role;
select pg_temp.check((pg_temp.ev('root')).archived_at is null and (pg_temp.ev('root')).title = 'Root renamed'
                 and (pg_temp.ev('solo')).id is not null, '1: direct writes refused; ordinary edits allowed');

-- ── 2. archive via RPC; archived hierarchy frozen; no direct restore ──────
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001301');
select public.admin_set_event_archived((pg_temp.ev('root')).id, true);
reset role;
select pg_temp.check((pg_temp.ev('root')).archived_at is not null and (pg_temp.ev('kid')).archived_at is not null, '2: RPC archives the whole subtree');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001301');
select pg_temp.expect_error($q$update public.events set archived_at = null, archived_by = null where slug = 'kid'$q$, 'EVENT_ARCHIVE_VIA_RPC');
select pg_temp.expect_error($q$update public.events set parent_event_id = null where slug = 'kid'$q$, 'ARCHIVED_EVENT_HIERARCHY_LOCKED');
select pg_temp.expect_error($q$update public.events set parent_event_id = (select id from public.events where slug = 'solo') where slug = 'kid'$q$, 'ARCHIVED_EVENT_HIERARCHY_LOCKED');
update public.events set title = 'Kid renamed', parent_event_id = parent_event_id where slug = 'kid';   -- edit keeps the parent
select pg_temp.expect_error($q$insert into public.events (slug, title, parent_event_id) values ('late', 'Late', (select id from public.events where slug = 'root'))$q$, 'PARENT_ARCHIVED');
select pg_temp.expect_error($q$update public.events set parent_event_id = (select id from public.events where slug = 'root') where slug = 'solo'$q$, 'PARENT_ARCHIVED');
select pg_temp.expect_error($q$select public.admin_set_event_archived((select id from public.events where slug = 'kid'), false)$q$, 'PARENT_ARCHIVED');
reset role;
select pg_temp.check((pg_temp.ev('kid')).title = 'Kid renamed' and (pg_temp.ev('kid')).parent_event_id = (pg_temp.ev('root')).id
                 and (pg_temp.ev('kid')).archived_at is not null, '2: archived child stays archived under its parent');

-- ── 3. restore + delete via RPC still work; delete keeps FK history guard ─
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001301');
select public.admin_set_event_archived((pg_temp.ev('root')).id, false);
select public.admin_set_event_archived((pg_temp.ev('root')).id, false);   -- idempotent
select public.admin_delete_event((pg_temp.ev('solo')).id);
select pg_temp.expect_error($q$select public.admin_set_event_archived(gen_random_uuid(), true)$q$, 'EVENT_NOT_FOUND');
select pg_temp.expect_error($q$select public.admin_set_event_archived((select id from public.events where slug = 'root'), null)$q$, 'INVALID_REQUEST');
select pg_temp.as_user('00000000-0000-0000-0000-000000001303');
select pg_temp.expect_error($q$select public.admin_set_event_archived((select id from public.events where slug = 'root'), true)$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$select public.lock_event_hierarchy()$q$, 'permission denied');
reset role;
select pg_temp.check((pg_temp.ev('root')).archived_at is null and (pg_temp.ev('kid')).archived_at is null and (pg_temp.ev('solo')).id is null,
  '3: restore brings the subtree back; RPC delete works');

-- ── 4. protected default event UPI vs General Registration ─────────────────
select pg_temp.check((select default_event_upi_id is null from public.payment_destination_settings), '4: default starts unset');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000001302');
select pg_temp.expect_error($q$select public.admin_set_general_registration_settings(true, 1000, 'gr@okbank', 'GR', '', '')$q$, 'DEFAULT_EVENT_UPI_NOT_CONFIGURED');
select public.admin_set_general_registration_settings(false, 1000, 'gr@okbank', 'GR', '', '');   -- closed drafts are fine
select pg_temp.expect_error($q$select public.admin_set_default_event_upi('GR@OKBANK')$q$, 'DEFAULT_UPI_MATCHES_GENERAL_REGISTRATION_UPI');
select pg_temp.expect_error($q$select public.admin_set_default_event_upi('not a upi')$q$, 'INVALID_UPI_ID');
select public.admin_set_default_event_upi('site.default@okbank');
select pg_temp.expect_error($q$select public.admin_set_general_registration_settings(true, 1000, 'Site.Default@OKBANK', 'GR', '', '')$q$, 'GENERAL_REGISTRATION_UPI_NOT_DEDICATED');
select public.admin_set_general_registration_settings(true, 1000, 'gr@okbank', 'GR', '', '');
select pg_temp.expect_error($q$update public.payment_destination_settings set default_event_upi_id = 'x@okbank'$q$, 'permission denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000001301');
select pg_temp.expect_error($q$select public.admin_set_default_event_upi('other@okbank')$q$, 'FORBIDDEN');
select pg_temp.as_user('00000000-0000-0000-0000-000000001303');
select pg_temp.expect_error($q$select public.admin_set_default_event_upi('other@okbank')$q$, 'FORBIDDEN');
reset role;
select pg_temp.expect_error($q$update public.general_registration_settings set upi_id = 'site.default@okbank'$q$, 'GENERAL_REGISTRATION_UPI_NOT_DEDICATED');
set role anon;
select pg_temp.check((select default_event_upi_id = 'site.default@okbank' from public.payment_destination_settings), '4: default UPI is publicly readable');
select pg_temp.expect_error($q$select public.admin_set_default_event_upi('x@okbank')$q$, 'permission denied');
reset role;
select pg_temp.check((select enabled and upi_id = 'gr@okbank' from public.general_registration_settings)
                 and (select default_event_upi_id = 'site.default@okbank' from public.payment_destination_settings), '4: final GR + default destinations distinct');
select 'ALL 0026 TESTS PASSED';
