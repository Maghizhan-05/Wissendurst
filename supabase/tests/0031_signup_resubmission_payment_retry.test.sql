-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0031: sign-up approval transitions + E-id release, same-account
-- resubmission, rejected-payment evidence and retry (solo + team).
\set ON_ERROR_STOP 1
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
\ir ../migrations/0031_signup_resubmission_payment_retry.sql

create or replace function pg_temp.expect_error(p_sql text, p_needle text) returns text
language plpgsql as $$
declare v_detail text;
begin
  execute p_sql;
  raise exception 'EXPECTED_ERROR_NOT_RAISED: % (wanted %)', p_sql, p_needle;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  if sqlerrm like 'EXPECTED_ERROR_NOT_RAISED%' or position(p_needle in sqlerrm || ' ' || coalesce(v_detail, '')) = 0 then
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
create or replace function pg_temp.u(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000031' || lpad(p_n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.as_user(p_n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, false) $$;
create or replace function pg_temp.prof(p_n int) returns public.profiles language sql stable security definer as $$
  select * from public.profiles where id = pg_temp.u(p_n) $$;
create or replace function pg_temp.ev(p_slug text) returns uuid language sql stable security definer as $$
  select id from public.events where slug = p_slug $$;
create or replace function pg_temp.reg(p_n int, p_slug text) returns public.registrations language sql stable security definer as $$
  select * from public.registrations where profile_id = pg_temp.u(p_n) and event_id = pg_temp.ev(p_slug) $$;
create or replace function pg_temp.card(p_n int, p_file text) returns void language sql security definer as $$
  insert into storage.objects (bucket_id, name) values ('id-cards', pg_temp.u(p_n)::text || '/' || p_file) $$;

-- 00 signups admin, 01 payments admin, 02 events-only admin, 03..12 applicants/participants
insert into auth.users (id, email, raw_user_meta_data)
select pg_temp.u(n), 'a'||n||'@x.test', json_build_object('full_name','A'||n)::jsonb from generate_series(0, 12) n;
update public.profiles set approval_status = 'approved', role = 'admin', admin_scopes = array['signups'] where id = pg_temp.u(0);
update public.profiles set approval_status = 'approved', role = 'admin', admin_scopes = array['payments'] where id = pg_temp.u(1);
update public.profiles set approval_status = 'approved', role = 'admin', admin_scopes = array['events'] where id = pg_temp.u(2);
update public.profiles set id_card_path = id::text || '/first.png' where role = 'user';

-- ── 1. transitions ─────────────────────────────────────────────────────────
set role authenticated;
select pg_temp.as_user(2);
select pg_temp.expect_error($q$select public.admin_set_approval(pg_temp.u(3), 'approved')$q$, 'FORBIDDEN');
select pg_temp.as_user(0);
select public.admin_set_approval(pg_temp.u(3), 'approved');
select public.admin_set_approval(pg_temp.u(4), 'approved');
select public.admin_set_approval(pg_temp.u(5), 'approved');
select public.admin_set_approval(pg_temp.u(3), 'approved');                -- idempotent
select pg_temp.expect_error($q$select public.admin_set_approval(pg_temp.u(3), 'rejected')$q$, 'INVALID_APPROVAL_TRANSITION');
select pg_temp.expect_error($q$select public.admin_set_approval(pg_temp.u(3), 'pending')$q$, 'INVALID_APPROVAL_TRANSITION');
select pg_temp.expect_error($q$select public.admin_set_approval(pg_temp.u(1), 'rejected')$q$, 'INVALID_APPROVAL_TRANSITION');
select public.admin_set_approval(pg_temp.u(6), 'rejected');
select pg_temp.expect_error($q$select public.admin_set_approval(pg_temp.u(6), 'approved')$q$, 'INVALID_APPROVAL_TRANSITION');
select pg_temp.expect_error($q$select public.admin_set_approval(pg_temp.u(6), 'pending')$q$, 'INVALID_APPROVAL_TRANSITION');
reset role;
select pg_temp.check((pg_temp.prof(3)).participant_id is not null and (pg_temp.prof(3)).approval_status = 'approved',
  '1: approval rejected for an approved participant; id kept');
select pg_temp.check((pg_temp.prof(6)).approval_status = 'rejected' and (pg_temp.prof(6)).participant_id is null,
  '1: pending -> rejected leaves no id');
select pg_temp.check((select count(*) = 4 from public.profile_approval_events), '1: one history row per real transition');

-- ── 2. a rejected applicant who held an E id releases it; reapproval reuses the lowest ─
-- (legacy shape: an id on a still-pending profile, e.g. pre-0021 data)
update public.profiles set approval_status = 'pending' where id = pg_temp.u(4);
create temp table rel as select (pg_temp.prof(4)).participant_id pid;
grant select on rel to authenticated;
set role authenticated;
select pg_temp.as_user(0);
select public.admin_set_approval(pg_temp.u(4), 'rejected');
reset role;
select pg_temp.check((pg_temp.prof(4)).participant_id is null
  and exists (select 1 from public.participant_id_released r join public.participant_id_namespaces n using (namespace)
              where r.namespace = 'E' and n.prefix || lpad(r.number::text, n.width, '0') = (select pid from rel))
  and exists (select 1 from public.participant_id_history h where h.profile_id = pg_temp.u(4) and h.action = 'released' and h.reason = 'sign-up rejected'),
  '2: rejecting releases the E id into the pool, with history');
set role authenticated;
select pg_temp.as_user(0);
select public.admin_set_approval(pg_temp.u(7), 'approved');          -- takes the released number
reset role;
select pg_temp.check((pg_temp.prof(7)).participant_id = (select pid from rel), '2: next approval reuses the lowest released id');

-- ── 3. same-account resubmission ───────────────────────────────────────────
select pg_temp.card(4, 'second.png');
select pg_temp.card(9, 'theirs.png');
set role authenticated;
select pg_temp.as_user(3);   -- approved: not a rejected application
select pg_temp.expect_error($q$select public.resubmit_my_application('A3', '9999999999', 'College', 'MBBS', '2nd', pg_temp.u(3)::text || '/x.png')$q$, 'APPLICATION_NOT_REJECTED');
select pg_temp.as_user(4);
select pg_temp.expect_error($q$select public.resubmit_my_application('A', '9999999999', 'College', 'MBBS', '2nd', pg_temp.u(4)::text || '/second.png')$q$, 'INVALID_PROFILE');
select pg_temp.expect_error($q$select public.resubmit_my_application('A Four', 'phone!', 'College', 'MBBS', '2nd', pg_temp.u(4)::text || '/second.png')$q$, 'INVALID_PROFILE');
select pg_temp.expect_error($q$select public.resubmit_my_application('A Four', '9999999999', 'College', 'MBBS', '2nd', pg_temp.u(4)::text || '/missing.png')$q$, 'INVALID_ID_CARD');
select pg_temp.expect_error($q$select public.resubmit_my_application('A Four', '9999999999', 'College', 'MBBS', '2nd', pg_temp.u(9)::text || '/theirs.png')$q$, 'INVALID_ID_CARD');
select pg_temp.expect_error($q$select public.resubmit_my_application('A Four', '9999999999', 'College', 'MBBS', '2nd', pg_temp.u(4)::text || '/../x.png')$q$, 'INVALID_ID_CARD');
select pg_temp.expect_error($q$select public.resubmit_my_application('A Four', '9999999999', 'College', 'MBBS', '2nd', pg_temp.u(4)::text || '/first.png')$q$, 'INVALID_ID_CARD');
select (public.resubmit_my_application('  A Four  ', '9999999999', 'ESIC Medical College', 'MBBS', '2nd', pg_temp.u(4)::text || '/second.png')).approval_status = 'pending';
select pg_temp.expect_error($q$select public.resubmit_my_application('A Four', '9999999999', 'College', 'MBBS', '2nd', pg_temp.u(4)::text || '/second.png')$q$, 'APPLICATION_NOT_REJECTED');
-- an applicant can read only their own history; can't write it
select pg_temp.check((select count(*) = 3 and bool_and(profile_id = pg_temp.u(4)) from public.profile_approval_events), '3: applicant sees only their own history');
select pg_temp.expect_error($q$insert into public.profile_approval_events (profile_id, from_status, to_status) values (pg_temp.u(4), 'pending', 'approved')$q$, 'permission denied');
create or replace function pg_temp.try_self_approve() returns text language plpgsql as $$
begin update public.profiles set approval_status = 'approved' where id = auth.uid(); return 'no error';
exception when others then return sqlerrm; end $$;
select pg_temp.try_self_approve();
reset role;
select pg_temp.check((pg_temp.prof(4)).full_name = 'A Four' and (pg_temp.prof(4)).college = 'ESIC Medical College'
  and (pg_temp.prof(4)).id_card_path = pg_temp.u(4)::text || '/second.png' and (pg_temp.prof(4)).participant_id is null
  and (pg_temp.prof(4)).approved_by is null,
  '3: same profile corrected, new ID card, pending (self-approval impossible), no id');
select pg_temp.check((select string_agg(from_status || '>' || to_status, ',' order by id) = 'pending>approved,pending>rejected,rejected>pending'
  from public.profile_approval_events where profile_id = pg_temp.u(4)), '3: history keeps rejection and resubmission');
select pg_temp.expect_error($q$update public.profile_approval_events set reason = 'x'$q$, 'APPEND_ONLY');
select pg_temp.expect_error($q$delete from public.profile_approval_events$q$, 'APPEND_ONLY');
set role authenticated;
select pg_temp.as_user(0);
select public.admin_set_approval(pg_temp.u(4), 'approved');
reset role;
select pg_temp.check((pg_temp.prof(4)).participant_id is not null and (pg_temp.prof(4)).participant_id <> (select pid from rel),
  '3: reapproval issues the lowest free number (the old one was reused meanwhile)');
set role anon;
select pg_temp.expect_error($q$select public.resubmit_my_application('A', '1', 'C', 'M', 'Y', 'x')$q$, 'permission denied');
reset role;

-- ── 4. rejected payment: evidence kept, retry with a different UTR (solo) ─
update public.profiles set approval_status = 'approved' where id in (pg_temp.u(8), pg_temp.u(9), pg_temp.u(10), pg_temp.u(11));
insert into public.events (slug, title, registration_fee, team_fee, registration_open, is_live, team_enabled, team_max, max_participants) values
  ('solo', 'Solo', 10000, 0, true, true, false, 1, 1),
  ('team', 'Team', 5000, 20000, true, true, true, 3, null);
set role authenticated;
select pg_temp.as_user(8);
select (public.register_for_event(pg_temp.ev('solo'))).id is not null;
select (public.submit_payment((pg_temp.reg(8, 'solo')).id, 'UTR11111111', 'shot-a.png')).payment_status = 'under_review';
select pg_temp.as_user(1);
select (public.admin_set_payment_status((pg_temp.reg(8, 'solo')).id, 'rejected', 'Amount does not match')).registration_status = 'rejected';
reset role;
select pg_temp.check((select count(*) = 1 and bool_and(transaction_id = 'UTR11111111' and payment_screenshot = 'shot-a.png' and note = 'Amount does not match' and amount = 10000)
  from public.payment_rejections), '4: rejection keeps the rejected screenshot, UTR and note');
-- the seat is free while rejected: someone else takes it
set role authenticated;
select pg_temp.as_user(9);
select (public.register_for_event(pg_temp.ev('solo'))).id is not null;
select pg_temp.as_user(8);
select pg_temp.expect_error($q$select public.submit_payment((pg_temp.reg(8, 'solo')).id, 'UTR22222222', 'shot-b.png')$q$, 'EVENT_FULL');
reset role;
update public.events set max_participants = 2 where slug = 'solo';
set role authenticated;
select pg_temp.as_user(8);
select pg_temp.expect_error($q$select public.submit_payment((pg_temp.reg(8, 'solo')).id, 'utr11111111', 'shot-b.png')$q$, 'UTR_PREVIOUSLY_REJECTED');
select (public.submit_payment((pg_temp.reg(8, 'solo')).id, 'UTR22222222', 'shot-b.png')).payment_status = 'under_review';
-- another person can't take over the rejected UTR either (still claimed)
select pg_temp.as_user(9);
select (public.submit_payment((pg_temp.reg(9, 'solo')).id, 'UTR11111111', 'shot-c.png')).payment_status = 'duplicate';
reset role;
select pg_temp.check((select count(*) = 1 from public.registrations where profile_id = pg_temp.u(8) and event_id = pg_temp.ev('solo'))
  and (pg_temp.reg(8, 'solo')).registration_status = 'pending' and (pg_temp.reg(8, 'solo')).transaction_id = 'UTR22222222'
  and (pg_temp.reg(8, 'solo')).payment_screenshot = 'shot-b.png' and (pg_temp.reg(8, 'solo')).hold_expires_at > now(),
  '4: retry reuses the same row with the new evidence and a fresh hold');
select pg_temp.check((select count(*) = 1 from public.payment_rejections) and
  (select count(*) >= 3 from public.payment_events where registration_id = (pg_temp.reg(8, 'solo')).id), '4: prior review history intact');
select pg_temp.expect_error($q$update public.payment_rejections set note = 'x'$q$, 'APPEND_ONLY');

-- ── 5. rejected team payment: whole team, head retries, roster stays locked ─
set role authenticated;
select pg_temp.as_user(10);
select public.register_team(pg_temp.ev('team'), array[pg_temp.u(11)], 'Retry Team');
select public.submit_payment((pg_temp.reg(10, 'team')).id, 'UTR33333333', 'team-a.png');
select pg_temp.as_user(1);
select public.admin_set_payment_status((pg_temp.reg(10, 'team')).id, 'rejected', 'Blurry');
reset role;
select pg_temp.check((pg_temp.reg(10, 'team')).registration_status = 'rejected' and (pg_temp.reg(11, 'team')).registration_status = 'rejected',
  '5: rejection applies to the whole team');
set role authenticated;
select pg_temp.as_user(11);
select pg_temp.expect_error($q$select public.submit_payment((pg_temp.reg(11, 'team')).id, 'UTR44444444', 'x.png')$q$, 'TEAM_HEAD_PAYS');
select pg_temp.as_user(10);
select pg_temp.expect_error($q$select public.edit_team_roster((pg_temp.reg(10, 'team')).id, array[pg_temp.u(11), pg_temp.u(12)], 'Retry Team')$q$, 'ROSTER_LOCKED');
select (public.submit_payment((pg_temp.reg(10, 'team')).id, 'UTR44444444', 'team-b.png')).payment_status = 'under_review';
select pg_temp.expect_error($q$select public.edit_team_roster((pg_temp.reg(10, 'team')).id, array[pg_temp.u(11)], 'Renamed')$q$, 'ROSTER_LOCKED');
reset role;
select pg_temp.check((pg_temp.reg(10, 'team')).registration_status = 'pending' and (pg_temp.reg(11, 'team')).registration_status = 'pending'
  and (select name = 'Retry Team' from public.teams where id = (pg_temp.reg(10, 'team')).team_id),
  '5: head retry returns the whole team to pending; name unchanged');
set role authenticated;
select pg_temp.as_user(1);
select public.admin_set_payment_status((pg_temp.reg(10, 'team')).id, 'verified', null);
reset role;
select pg_temp.check((pg_temp.reg(10, 'team')).registration_status = 'confirmed' and (pg_temp.reg(11, 'team')).registration_status = 'confirmed',
  '5: verification confirms every member at once');

-- ── 6. visibility of evidence history ──────────────────────────────────────
set role authenticated;
select pg_temp.as_user(9);
select pg_temp.check((select count(*) = 0 from public.payment_rejections), '6: other participants can''t read a rejection');
select pg_temp.as_user(8);
select pg_temp.check((select count(*) = 1 from public.payment_rejections), '6: the owner can read their rejection');
select pg_temp.as_user(2);
select pg_temp.check((select count(*) = 0 from public.payment_rejections), '6: admins without payments scope can''t');
reset role;

-- ── 7. schedule column ─────────────────────────────────────────────────────
insert into public.site_settings (id) values (1) on conflict (id) do nothing;
select pg_temp.expect_error($q$update public.site_settings set schedule = '[]'::jsonb$q$, 'site_settings_schedule_object');
update public.site_settings set schedule = '{"heading":"Three days"}';
select pg_temp.check((select schedule->>'heading' = 'Three days' from public.site_settings), '7: schedule wording stored as an object');

-- ── 8. re-run is safe ──────────────────────────────────────────────────────
\ir ../migrations/0031_signup_resubmission_payment_retry.sql
select pg_temp.check((select count(*) from public.profile_approval_events) = 8 and (select count(*) from public.payment_rejections) = 2,
  '8: re-run keeps history');
select 'ALL 0031 TESTS PASSED';
