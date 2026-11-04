-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0023_general_registration: settings + dedicated UPI, coverage, gating of
-- solo/team/payment RPCs, free covered enrolment, GR intents with frozen
-- terms, global UTR claims, RLS matrix, atomic idempotent E -> GR conversion,
-- released-E reuse (E0004 regression), rollback at every conversion step.
\set ON_ERROR_STOP 1
grant all on all tables in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated;
\ir ../migrations/0021_participant_id_allocator.sql
\ir ../migrations/0022_profile_update_lockdown.sql
\ir ../migrations/0023_general_registration.sql

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
create or replace function pg_temp.u(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000008' || lpad(p_n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.ev(p_slug text) returns uuid language sql stable security definer as $$
  select id from public.events where slug = p_slug $$;
create or replace function pg_temp.as_user(p_n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, false) $$;
create or replace function pg_temp.pid_of(p_n int) returns text language sql stable security definer as $$
  select participant_id from public.profiles where id = pg_temp.u(p_n) $$;
create or replace function pg_temp.gr(p_n int) returns public.general_registrations language sql stable security definer as $$
  select * from public.general_registrations where profile_id = pg_temp.u(p_n) $$;
create or replace function pg_temp.reg(p_n int, p_slug text) returns public.registrations language sql stable security definer as $$
  select * from public.registrations where profile_id = pg_temp.u(p_n) and event_id = pg_temp.ev(p_slug) $$;
create or replace function pg_temp.fp() returns text language sql stable security definer as $$
  select md5(concat_ws('|',
    (select json_agg(a order by namespace, number)::text from public.participant_id_allocations a),
    (select json_agg(r order by namespace, number)::text from public.participant_id_released r),
    (select count(*) from public.participant_id_history),
    (select string_agg(namespace || next_number, ',' order by namespace) from public.participant_id_namespaces),
    (select string_agg(id || coalesce(participant_id, '-'), ',' order by id) from public.profiles),
    (select json_agg(g order by id)::text from public.general_registrations g),
    (select count(*) from public.general_registration_payment_events))) $$;

-- Users: 0 super admin, 1 payments admin, 2 events admin, 3 signups admin,
-- 10..19 participants (approved in order -> W27/E/0001..), 20 pending.
insert into auth.users (id, email, raw_user_meta_data)
select pg_temp.u(n), 'g' || n || '@x.test', json_build_object('full_name', 'G' || n)::jsonb
from generate_series(0, 20) n;
update public.profiles set approval_status = 'approved', role = 'admin' where id in (pg_temp.u(0), pg_temp.u(1), pg_temp.u(2), pg_temp.u(3));
update public.profiles set is_super_admin = true where id = pg_temp.u(0);
update public.profiles set admin_scopes = array['payments'] where id = pg_temp.u(1);
update public.profiles set admin_scopes = array['events'] where id = pg_temp.u(2);
update public.profiles set admin_scopes = array['signups'] where id = pg_temp.u(3);
set role authenticated;
select pg_temp.as_user(3);
select public.admin_set_approval(pg_temp.u(n), 'approved') from generate_series(10, 16) n;
reset role;
select pg_temp.check(pg_temp.pid_of(10) = 'W27/E/0001' and pg_temp.pid_of(13) = 'W27/E/0004' and pg_temp.pid_of(16) = 'W27/E/0007',
  'setup: participants hold W27/E/0001..0007');

insert into public.events (slug, title, registration_fee, team_fee, registration_open, is_live, team_enabled, team_min, team_max, max_participants, upi_id) values
 ('cov',     'Covered solo', 50000, 0,     true, true, false, 2, 4, 1,    null),
 ('cov2',    'Covered roomy', 50000, 0,    true, true, false, 2, 4, null, null),
 ('covteam', 'Covered team', 40000, 90000, true, true, true,  2, 2, 4,    null),
 ('plain',   'Plain',        30000, 0,     true, true, false, 2, 4, null, 'Event.Pay@Bank'),
 ('hub',     'Hub',          0,     0,     true, true, false, 2, 4, null, null);
insert into public.events (slug, title, registration_fee, registration_open, is_live, parent_event_id)
values ('hub1', 'Hub child', 1000, true, true, pg_temp.ev('hub'));

-- ── 1. defaults ─────────────────────────────────────────────────────────────
select pg_temp.check((select not enabled and upi_id is null and fee = 0 from public.general_registration_settings),
  '1: GR disabled, no UPI, no fee after migration');
select pg_temp.check(not exists (select 1 from public.events where general_registration_covered), '1: no covered events after migration');

-- ── 2. settings + dedicated UPI ─────────────────────────────────────────────
set role authenticated;
select pg_temp.as_user(2);
select pg_temp.expect_error($q$select public.admin_set_general_registration_settings(true, 100000, 'gr@bank', 'Org', '', '')$q$, 'FORBIDDEN');
select pg_temp.as_user(10);
select pg_temp.expect_error($q$select public.admin_set_general_registration_settings(true, 100000, 'gr@bank', 'Org', '', '')$q$, 'FORBIDDEN');
select pg_temp.as_user(1);
select pg_temp.expect_error($q$select public.admin_set_general_registration_settings(true, 100000, null, 'Org', '', '')$q$, 'GENERAL_REGISTRATION_INCOMPLETE');
select pg_temp.expect_error($q$select public.admin_set_general_registration_settings(true, 0, 'gr@bank', 'Org', '', '')$q$, 'GENERAL_REGISTRATION_INCOMPLETE');
select pg_temp.expect_error($q$select public.admin_set_general_registration_settings(true, 100000, 'gr@bank', '  ', '', '')$q$, 'GENERAL_REGISTRATION_INCOMPLETE');
select pg_temp.expect_error($q$select public.admin_set_general_registration_settings(true, 100000, 'not a upi', 'Org', '', '')$q$, 'INVALID_UPI_ID');
select pg_temp.expect_error($q$select public.admin_set_general_registration_settings(true, -5, 'gr@bank', 'Org', '', '')$q$, 'INVALID_FEE');
select pg_temp.expect_error($q$select public.admin_set_general_registration_settings(true, 100000, 'event.pay@bank', 'Org', '', '')$q$, 'GENERAL_REGISTRATION_UPI_NOT_DEDICATED');
select public.admin_set_general_registration_settings(true, 100000, 'wd27.general@okbank', 'Wissendurst GR', 'One pass', 'Pay exact amount');
reset role;
select pg_temp.check((select enabled and fee = 100000 and upi_id = 'wd27.general@okbank' from public.general_registration_settings), '2: payments admin configures GR');
select pg_temp.expect_error($q$update public.events set upi_id = 'WD27.General@OKBANK' where slug = 'plain'$q$, 'EVENT_UPI_MATCHES_GENERAL_REGISTRATION_UPI');
select pg_temp.expect_error($q$update public.general_registration_settings set enabled = true, upi_id = null$q$, 'general_registration_settings_open_requires_config');

-- ── 3. coverage ─────────────────────────────────────────────────────────────
set role authenticated;
select pg_temp.as_user(2);
select pg_temp.expect_error($q$select public.admin_set_general_registration_events(array[pg_temp.ev('cov')])$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$update public.events set general_registration_covered = true where slug = 'cov'$q$, 'GENERAL_REGISTRATION_COVERAGE_VIA_RPC');
select pg_temp.as_user(1);
select pg_temp.expect_error($q$select public.admin_set_general_registration_events(array[pg_temp.ev('hub')])$q$, 'HAS_SUBEVENTS');
select pg_temp.expect_error($q$select public.admin_set_general_registration_events(array[gen_random_uuid()])$q$, 'EVENT_NOT_FOUND');
select pg_temp.check(public.admin_set_general_registration_events(array[pg_temp.ev('cov'), pg_temp.ev('covteam'), pg_temp.ev('plain')]) = 3, '3: three events covered');
select pg_temp.check(public.admin_set_general_registration_events(array[pg_temp.ev('cov'), pg_temp.ev('cov2'), pg_temp.ev('covteam')]) = 3, '3: set replaced exactly (plain uncovered, cov2 covered)');
reset role;
select pg_temp.check((select string_agg(slug, ',' order by slug) from public.events where general_registration_covered) = 'cov,cov2,covteam', '3: covered = cov,cov2,covteam');

-- ── 4. gating for participants without GR ──────────────────────────────────
set role authenticated;
select pg_temp.as_user(10);
select pg_temp.expect_error($q$select public.register_for_event(pg_temp.ev('cov'))$q$, 'GENERAL_REGISTRATION_REQUIRED');
select pg_temp.expect_error($q$select public.register_team(pg_temp.ev('covteam'), array[pg_temp.u(11)])$q$, 'GENERAL_REGISTRATION_REQUIRED');
select public.register_for_event(pg_temp.ev('plain'));
select pg_temp.check((select solo_amount = 50000 from public.my_offer_prices(array[pg_temp.ev('cov')])), '4: non-GR preview shows the full price');
reset role;
-- an intent created before the event became covered cannot be paid individually
insert into public.registrations (profile_id, event_id, amount, registration_status, payment_status, hold_expires_at)
values (pg_temp.u(11), pg_temp.ev('cov2'), 50000, 'pending', 'unpaid', now() + interval '72 hours');
set role authenticated;
select pg_temp.as_user(11);
select pg_temp.expect_error($q$select public.submit_payment((select id from public.registrations where profile_id = auth.uid() and event_id = pg_temp.ev('cov2')), 'UTR999999', null)$q$, 'GENERAL_REGISTRATION_REQUIRED');
reset role;
delete from public.registrations where profile_id = pg_temp.u(11) and event_id = pg_temp.ev('cov2');

-- ── 5. GR intents: frozen terms, resume, closed, approval ──────────────────
set role authenticated;
select pg_temp.as_user(20);
select pg_temp.expect_error($q$select public.start_general_registration()$q$, 'NOT_APPROVED');
select pg_temp.as_user(13);
select public.start_general_registration();
select pg_temp.as_user(1);
select public.admin_set_general_registration_settings(true, 150000, 'wd27.gr2@okbank', 'Changed', '', '');
select pg_temp.as_user(13);
select public.start_general_registration();
reset role;
select pg_temp.check((select amount = 100000 and upi_id = 'wd27.general@okbank' and payee_name = 'Wissendurst GR' and status = 'unpaid'
                      from pg_temp.gr(13)), '5: fee + UPI frozen at creation; resume returns the same intent');
select pg_temp.check((select count(*) = 1 from public.general_registrations where profile_id = pg_temp.u(13)), '5: one GR record per participant');
set role authenticated;
select pg_temp.as_user(14);
select public.start_general_registration();
reset role;
select pg_temp.check((select amount = 150000 and upi_id = 'wd27.gr2@okbank' from pg_temp.gr(14)), '5: a new intent takes the current terms');
set role authenticated;
select pg_temp.as_user(1);
select public.admin_set_general_registration_settings(false, 150000, 'wd27.gr2@okbank', 'Changed', '', '');
select pg_temp.as_user(15);
select pg_temp.expect_error($q$select public.start_general_registration()$q$, 'GENERAL_REGISTRATION_CLOSED');
select pg_temp.as_user(1);
select public.admin_set_general_registration_settings(true, 150000, 'wd27.gr2@okbank', 'Changed', '', '');
reset role;

-- ── 6. submissions + global UTR claims ─────────────────────────────────────
set role authenticated;
select pg_temp.as_user(10);
select public.submit_payment((select id from public.registrations where profile_id = auth.uid() and event_id = pg_temp.ev('plain')),
                             'UTR111111', pg_temp.u(10) || '/plain.png');
select pg_temp.as_user(13);
select pg_temp.expect_error($q$select public.submit_general_registration_payment(null, '00000000-0000-0000-0000-000000000810/x.png')$q$, 'INVALID_SCREENSHOT');
select pg_temp.expect_error($q$select public.submit_general_registration_payment('abc', null)$q$, 'INVALID_TRANSACTION_ID');
select public.submit_general_registration_payment(null, pg_temp.u(13) || '/gr.png', 'raw', 0.4);
reset role;
select pg_temp.check((select status = 'uploaded' and payment_screenshot like '%/gr.png' from pg_temp.gr(13)), '6: screenshot-only -> uploaded');
set role authenticated;
select pg_temp.as_user(13);
select public.submit_general_registration_payment(' utr111111 ', null);
reset role;
select pg_temp.check((select status = 'duplicate' and transaction_id is null from pg_temp.gr(13)), '6: GR UTR already used by an event payment -> duplicate');
select pg_temp.check((select note like 'Transaction id already used by registration %' from public.general_registration_payment_events
                      where profile_id = pg_temp.u(13) order by id desc limit 1), '6: duplicate audit names the event registration');
set role authenticated;
select pg_temp.as_user(13);
select public.submit_general_registration_payment('UTR222222', null);
select pg_temp.as_user(11);
select public.register_for_event(pg_temp.ev('plain'));
select public.submit_payment((select id from public.registrations where profile_id = auth.uid() and event_id = pg_temp.ev('plain')), 'utr222222', null);
reset role;
select pg_temp.check((select status = 'under_review' and transaction_id = 'UTR222222' from pg_temp.gr(13)), '6: corrected UTR -> under_review');
select pg_temp.check((pg_temp.reg(11, 'plain')).payment_status = 'duplicate', '6: event payment reusing a GR UTR -> duplicate');
select pg_temp.check((select count(*) = 2 from public.payment_utr_claims) and exists (select 1 from public.payment_utr_claims where utr = 'UTR222222' and general_registration_id = (pg_temp.gr(13)).id),
  '6: claims mirror held UTRs across both payment kinds');
select pg_temp.expect_error($q$insert into public.payment_utr_claims (utr) values ('X')$q$, 'payment_utr_claims_one_owner');

-- ── 7. RLS matrix ───────────────────────────────────────────────────────────
set role anon;
select pg_temp.expect_error($q$select count(*) from public.general_registrations$q$, 'permission denied');
select pg_temp.expect_error($q$select count(*) from public.general_registration_payment_events$q$, 'permission denied');
select pg_temp.expect_error($q$select count(*) from public.payment_utr_claims$q$, 'permission denied');
select pg_temp.expect_error($q$select public.start_general_registration()$q$, 'permission denied');
select pg_temp.check((select count(*) = 1 from public.general_registration_settings), '7: anon can read GR settings (public page copy)');
reset role;
set role authenticated;
select pg_temp.as_user(13);
select pg_temp.check((select count(*) = 1 and bool_and(profile_id = auth.uid()) from public.general_registrations), '7: participant sees only their own GR record');
select pg_temp.check((select count(*) > 0 and bool_and(profile_id = auth.uid()) from public.general_registration_payment_events), '7: participant sees only their own audit');
select pg_temp.check((select count(*) = 0 from public.payment_utr_claims), '7: participant sees no UTR claims');
select pg_temp.expect_error($q$update public.general_registrations set status = 'verified'$q$, 'permission denied');
select pg_temp.expect_error($q$insert into public.general_registrations (profile_id, amount, upi_id, payee_name) values (auth.uid(), 1, 'a@b', 'x')$q$, 'permission denied');
select pg_temp.expect_error($q$update public.general_registration_settings set fee = 1$q$, 'permission denied');
select pg_temp.expect_error($q$select public.admin_review_general_registration((select id from public.general_registrations limit 1), 'verified')$q$, 'FORBIDDEN');
select pg_temp.as_user(2);
select pg_temp.check((select count(*) = 0 from public.general_registrations) and (select count(*) = 0 from public.general_registration_payment_events),
  '7: events admin sees no GR payments');
select pg_temp.expect_error($q$select public.admin_review_general_registration((select (pg_temp.gr(13)).id), 'verified')$q$, 'FORBIDDEN');
select pg_temp.as_user(1);
select pg_temp.check((select count(*) = 2 from public.general_registrations) and (select count(*) = 2 from public.payment_utr_claims), '7: payments admin sees all GR records + claims');
select pg_temp.as_user(0);
select pg_temp.check((select count(*) = 2 from public.general_registrations), '7: super admin sees all GR records');
reset role;
select pg_temp.expect_error($q$update public.general_registration_payment_events set note = 'x'$q$, 'GENERAL_REGISTRATION_AUDIT_APPEND_ONLY');
select pg_temp.expect_error($q$delete from public.general_registration_payment_events$q$, 'GENERAL_REGISTRATION_AUDIT_APPEND_ONLY');
select pg_temp.expect_error($q$truncate public.general_registration_payment_events$q$, 'GENERAL_REGISTRATION_AUDIT_APPEND_ONLY');

-- ── 8. review: reject keeps E, verify converts E -> GR atomically ──────────
set role authenticated;
select pg_temp.as_user(1);
select pg_temp.expect_error($q$select public.admin_review_general_registration((select (pg_temp.gr(13)).id), 'duplicate')$q$, 'INVALID_STATUS');
select public.admin_review_general_registration((pg_temp.gr(13)).id, 'rejected', 'Blurry');
reset role;
select pg_temp.check((pg_temp.gr(13)).status = 'rejected' and pg_temp.pid_of(13) = 'W27/E/0004', '8: rejection leaves the E id unchanged');
set role authenticated;
select pg_temp.as_user(13);
select public.submit_general_registration_payment('UTR222222', pg_temp.u(13) || '/gr2.png');
reset role;
select pg_temp.check((pg_temp.gr(13)).status = 'under_review', '8: participant can resubmit after rejection (same UTR stays theirs)');
select pg_temp.check(not exists (select 1 from public.registrations where profile_id = pg_temp.u(13)), '8: no event registrations before verification');
create temp table hist_before as select count(*) n from public.participant_id_history;
set role authenticated;
select pg_temp.as_user(1);
select public.admin_review_general_registration((pg_temp.gr(13)).id, 'verified', 'OK');
reset role;
select pg_temp.check(pg_temp.pid_of(13) = 'W27/GR/0001', '8: verified participant now holds W27/GR/0001');
select pg_temp.check((select status = 'verified' and previous_participant_id = 'W27/E/0004' and new_participant_id = 'W27/GR/0001'
                        and verified_by = pg_temp.u(1) from pg_temp.gr(13)), '8: GR record stores previous + new ids');
select pg_temp.check(exists (select 1 from public.participant_id_released where namespace = 'E' and number = 4), '8: E0004 released to the reuse pool');
select pg_temp.check((select string_agg(action || ':' || participant_id, ',' order by id) from public.participant_id_history
                      where profile_id = pg_temp.u(13)) = 'assigned:W27/E/0004,released:W27/E/0004,assigned:W27/GR/0001', '8: id history release + assign');
select pg_temp.check((select previous_participant_id = 'W27/E/0004' and new_participant_id = 'W27/GR/0001' and to_status = 'verified'
                      from public.general_registration_payment_events where profile_id = pg_temp.u(13) order by id desc limit 1), '8: audit records the conversion');
select pg_temp.check(not exists (select 1 from public.registrations where profile_id = pg_temp.u(13)), '8: no automatic enrolment into covered events');
create temp table after_verify as select pg_temp.fp() f;
set role authenticated;
select pg_temp.as_user(0);
select public.admin_review_general_registration((pg_temp.gr(13)).id, 'verified');
select pg_temp.expect_error($q$select public.admin_review_general_registration((select (pg_temp.gr(13)).id), 'rejected')$q$, 'GENERAL_REGISTRATION_ALREADY_VERIFIED');
select pg_temp.as_user(13);
select pg_temp.check((public.start_general_registration()).status = 'verified', '8: start returns the verified record');
select pg_temp.expect_error($q$select public.submit_general_registration_payment('UTR333333', null)$q$, 'ALREADY_PAID');
reset role;
select pg_temp.check((select f = pg_temp.fp() from after_verify), '8: re-verification is idempotent (no new GR id, no new rows)');

-- ── 9. E0004 regression: next approval reuses the lowest released E ────────
set role authenticated;
select pg_temp.as_user(3);
select public.admin_set_approval(pg_temp.u(17), 'approved');
select public.admin_set_approval(pg_temp.u(18), 'approved');
reset role;
select pg_temp.check(pg_temp.pid_of(17) = 'W27/E/0004', '9: next approval receives W27/E/0004 although E0005..E0007 exist');
select pg_temp.check(pg_temp.pid_of(18) = 'W27/E/0008', '9: then the fresh counter continues at W27/E/0008');

-- ── 10. covered enrolment for GR participants: free, but rules still apply ─
set role authenticated;
select pg_temp.as_user(13);
select pg_temp.check((select solo_amount = 0 and solo_list = 50000 from public.my_offer_prices(array[pg_temp.ev('cov')])), '10: GR preview shows the covered event as free');
select public.register_for_event(pg_temp.ev('cov'));
select pg_temp.expect_error($q$select public.register_for_event(pg_temp.ev('cov'))$q$, 'ALREADY_REGISTERED');
select pg_temp.expect_error($q$select public.register_for_event(pg_temp.ev('covteam'))$q$, 'TEAM_EVENT');
select pg_temp.check((select solo_amount = 30000 from public.my_offer_prices(array[pg_temp.ev('plain')])), '10: uncovered events keep their price');
reset role;
select pg_temp.check((select amount = 0 and list_price = 50000 and registration_status = 'confirmed' and payment_status = 'verified'
                      and hold_expires_at is null from pg_temp.reg(13, 'cov')), '10: covered enrolment confirmed at 0 (list price kept)');
-- second GR participant (user 14) to test capacity + teams
set role authenticated;
select pg_temp.as_user(14);
select public.submit_general_registration_payment('UTR444444', pg_temp.u(14) || '/g.png');
select pg_temp.as_user(1);
select public.admin_review_general_registration((pg_temp.gr(14)).id, 'verified');
select pg_temp.as_user(14);
select pg_temp.expect_error($q$select public.register_for_event(pg_temp.ev('cov'))$q$, 'EVENT_FULL');
select pg_temp.expect_error($q$select public.register_team(pg_temp.ev('covteam'), array[pg_temp.u(13), pg_temp.u(10)])$q$, 'TEAM_TOO_LARGE');
select pg_temp.expect_error($q$select public.register_team(pg_temp.ev('covteam'), array[pg_temp.u(10)])$q$, 'GENERAL_REGISTRATION_REQUIRED');
select public.register_team(pg_temp.ev('covteam'), array[pg_temp.u(13)]);
reset role;
select pg_temp.check(pg_temp.pid_of(14) = 'W27/GR/0002', '10: second conversion gets W27/GR/0002');
select pg_temp.check((select count(*) = 2 and bool_and(registration_status = 'confirmed' and amount = 0) from public.registrations
                      where event_id = pg_temp.ev('covteam')), '10: GR team enrolment confirmed at 0 for both members');
set role authenticated;
select pg_temp.as_user(13);
select pg_temp.expect_error($q$select public.register_team(pg_temp.ev('covteam'), array[pg_temp.u(14)])$q$, 'MEMBER_ALREADY_REGISTERED');
reset role;

-- ── 11. rollback at every conversion step ──────────────────────────────────
-- user 15 has a GR payment under review; each injected failure must leave
-- every id/GR/audit row exactly as it was.
set role authenticated;
select pg_temp.as_user(15);
select public.start_general_registration();
select public.submit_general_registration_payment('UTR555555', null);
reset role;
create or replace function public.test_inject_failure() returns trigger language plpgsql as $$
begin raise exception 'INJECTED_FAILURE_%', tg_table_name; end $$;
create or replace function pg_temp.verify_with_failure(p_trigger_sql text, p_drop_sql text) returns text
language plpgsql as $$
declare v_before text := pg_temp.fp(); v_err text;
begin
  execute p_trigger_sql;
  begin
    perform set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
    perform public.admin_review_general_registration((pg_temp.gr(15)).id, 'verified');
    v_err := 'NO ERROR';
  exception when others then v_err := sqlerrm;
  end;
  execute p_drop_sql;
  if v_err not like 'INJECTED_FAILURE%' and v_err not like 'PARTICIPANT_ID_SPACE_EXHAUSTED%' then
    raise exception 'FAIL: expected injected failure, got %', v_err;
  end if;
  if pg_temp.fp() <> v_before then raise exception 'FAIL: partial conversion persisted after %', v_err; end if;
  return 'PASS rollback after ' || v_err;
end $$;
select pg_temp.verify_with_failure(
  'create trigger tf before insert on public.participant_id_released for each row execute function public.test_inject_failure()',
  'drop trigger tf on public.participant_id_released');                                        -- step 3 release
select pg_temp.verify_with_failure(
  'create trigger tf before insert on public.participant_id_allocations for each row when (new.namespace = ''GR'') execute function public.test_inject_failure()',
  'drop trigger tf on public.participant_id_allocations');                                     -- step 4 allocate
select pg_temp.verify_with_failure(
  'update public.participant_id_namespaces set next_number = 10000 where namespace = ''GR''',
  'update public.participant_id_namespaces set next_number = 3 where namespace = ''GR''');      -- step 4 exhausted
select pg_temp.verify_with_failure(
  'create trigger tf before update of participant_id on public.profiles for each row when (new.participant_id like ''W27/GR/%'') execute function public.test_inject_failure()',
  'drop trigger tf on public.profiles');                                                       -- step 5 profile id
select pg_temp.verify_with_failure(
  'create trigger tf before insert on public.participant_id_history for each row when (new.namespace = ''GR'') execute function public.test_inject_failure()',
  'drop trigger tf on public.participant_id_history');                                         -- step 6 history
select pg_temp.verify_with_failure(
  'create trigger tf before update on public.general_registrations for each row when (new.status = ''verified'') execute function public.test_inject_failure()',
  'drop trigger tf on public.general_registrations');                                          -- step 7 verify
select pg_temp.verify_with_failure(
  'create trigger tf before insert on public.general_registration_payment_events for each row execute function public.test_inject_failure()',
  'drop trigger tf on public.general_registration_payment_events');                            -- step 7 audit
drop function public.test_inject_failure();
select pg_temp.check(pg_temp.pid_of(15) = 'W27/E/0006' and (pg_temp.gr(15)).status = 'under_review', '11: after all injected failures user 15 is untouched');
-- step 2: a GR record whose owner holds no E id cannot be verified
insert into public.general_registrations (profile_id, status, amount, upi_id, payee_name, transaction_id)
values (pg_temp.u(20), 'under_review', 100, 'x@bank', 'x', 'UTR666666');
create temp table fp_noe as select pg_temp.fp() f;
set role authenticated;
select pg_temp.as_user(1);
select pg_temp.expect_error($q$select public.admin_review_general_registration((select (pg_temp.gr(20)).id), 'verified')$q$, 'GENERAL_REGISTRATION_REQUIRES_E_ID');
reset role;
select pg_temp.check((select f = pg_temp.fp() from fp_noe), '11: missing E id aborts with nothing changed');
-- finally the clean path still works
set role authenticated;
select pg_temp.as_user(1);
select public.admin_review_general_registration((pg_temp.gr(15)).id, 'verified');
reset role;
select pg_temp.check(pg_temp.pid_of(15) = 'W27/GR/0003', '11: conversion succeeds once failures are removed');
select pg_temp.check(not exists (select 1 from public.profiles p left join public.participant_id_allocations a on a.profile_id = p.id
                                 where p.participant_id is distinct from a.participant_id), '11: every profile still matches its allocation');
select 'ALL 0023 TESTS PASSED';
