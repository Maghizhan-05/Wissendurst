-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0018_payment_verification_capacity_guard: admin verification/review can't
-- overbook; active holds verify freely; expired/rejected intents and teams must
-- re-acquire seats atomically; failures change nothing; re-verify idempotent.
\set ON_ERROR_STOP 1
grant all on all tables in schema public to anon, authenticated;

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
  select ('00000000-0000-0000-0000-0000000002' || lpad(p_n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.ev(p_slug text) returns uuid language sql stable security definer as $$
  select id from public.events where slug = p_slug $$;
create or replace function pg_temp.reg(p_n int, p_slug text) returns public.registrations language sql stable security definer as $$
  select * from public.registrations where profile_id = pg_temp.u(p_n) and event_id = pg_temp.ev(p_slug) $$;
create or replace function pg_temp.seats(p_slug text) returns int language sql stable security definer as $$
  select public.event_seats_taken(pg_temp.ev(p_slug)) $$;
create or replace function pg_temp.reviews(p_slug text) returns int language sql stable security definer as $$
  select count(*)::int from public.payment_events pe join public.registrations r on r.id = pe.registration_id
  where r.event_id = pg_temp.ev(p_slug) and pe.action = 'admin_review' $$;
create or replace function pg_temp.snapshot(p_slug text) returns text language sql stable security definer as $$
  select string_agg(registration_status||'/'||payment_status||'/'||coalesce(hold_expires_at::text,'-')||'/'||coalesce(verified_at::text,'-'), ',' order by id)
  from public.registrations where event_id = pg_temp.ev(p_slug) $$;
create or replace function pg_temp.as_user(p_n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, false) $$;
create or replace function pg_temp.expire_reg(p_n int, p_slug text) returns void language sql security definer as $$
  update public.registrations set hold_expires_at = now() - interval '1 minute'
  where profile_id = pg_temp.u(p_n) and event_id = pg_temp.ev(p_slug) $$;
create or replace function pg_temp.expire_event(p_slug text) returns void language sql security definer as $$
  update public.registrations set hold_expires_at = now() - interval '1 minute'
  where event_id = pg_temp.ev(p_slug) $$;
create temp table snap(label text primary key, v text);
grant all on snap to authenticated;
create or replace function pg_temp.save(p_label text, p_v text) returns void language sql security definer as $$
  insert into snap values (p_label, p_v) on conflict (label) do update set v = excluded.v $$;
create or replace function pg_temp.saved(p_label text) returns text language sql stable security definer as $$
  select v from snap where label = p_label $$;

insert into auth.users (id, email, raw_user_meta_data)
select pg_temp.u(n), 'v'||n||'@x.test', json_build_object('full_name','V'||n)::jsonb
from generate_series(0, 6) n;
update public.profiles set approval_status = 'approved';
update public.profiles set role = 'admin', admin_scopes = array['events','payments'] where id = pg_temp.u(0);

insert into public.events (slug, title, registration_fee, team_fee, registration_open, is_live, team_enabled, team_max, max_participants) values
 ('a',   'Active',    1000, 0,    true, true, false, 4, 1),
 ('b',   'Expired',   1000, 0,    true, true, false, 4, 1),
 ('c',   'Rejected',  1000, 0,    true, true, false, 4, 1),
 ('t',   'TeamExp',   1000, 3000, true, true, true,  3, 4),
 ('t2',  'TeamFull',  1000, 3000, true, true, true,  3, 3),
 ('u',   'Unlimited', 1000, 0,    true, true, false, 4, null),
 ('arc', 'Archived',  1000, 0,    true, true, false, 4, 1);

set role authenticated;

-- A. Active hold on a full event: verification needs no extra capacity; idempotent
select pg_temp.as_user(1);
select (public.register_for_event(pg_temp.ev('a'))).id is not null;
select pg_temp.check(pg_temp.seats('a') = 1, 'A: event full with one live hold');
select pg_temp.as_user(0);
select (public.admin_set_payment_status((pg_temp.reg(1,'a')).id, 'verified', null)).registration_status = 'confirmed';
select pg_temp.check(pg_temp.seats('a') = 1, 'A: verifying an active hold on a full event succeeds without extra seat');
select pg_temp.save('a_verified_at', (pg_temp.reg(1,'a')).verified_at::text);
select pg_sleep(0.05);
select (public.admin_set_payment_status((pg_temp.reg(1,'a')).id, 'verified', null)).payment_status = 'verified';
select pg_temp.check((pg_temp.reg(1,'a')).verified_at::text = pg_temp.saved('a_verified_at') and pg_temp.seats('a') = 1,
  'A: re-verification is idempotent (same verifier time, same seats)');

-- B. Expired individual intent on a full event: refused, nothing changes; succeeds once a seat frees
select pg_temp.as_user(1);
select (public.register_for_event(pg_temp.ev('b'))).id is not null;
reset role; select pg_temp.expire_reg(1, 'b'); set role authenticated;
select pg_temp.as_user(2);
select (public.register_for_event(pg_temp.ev('b'))).id is not null;
select pg_temp.save('b_snap', pg_temp.snapshot('b'));
select pg_temp.save('b_reviews', pg_temp.reviews('b')::text);
select pg_temp.as_user(0);
select pg_temp.expect_error(format($q$select public.admin_set_payment_status(%L, 'verified', null)$q$, (pg_temp.reg(1,'b')).id), 'EVENT_FULL_AT_VERIFICATION');
select pg_temp.check(pg_temp.snapshot('b') = pg_temp.saved('b_snap') and pg_temp.reviews('b')::text = pg_temp.saved('b_reviews'),
  'B: refused verification changed no rows and wrote no audit entry');
select pg_temp.check(pg_temp.seats('b') = 1, 'B: still exactly one seat taken');
select pg_temp.as_user(2);
select (public.cancel_registration((pg_temp.reg(2,'b')).id)).registration_status = 'cancelled';
select pg_temp.as_user(0);
select (public.admin_set_payment_status((pg_temp.reg(1,'b')).id, 'verified', null)).registration_status = 'confirmed';
select pg_temp.check(pg_temp.seats('b') = 1, 'B: expired intent re-acquired the freed seat on verification');

-- C. Rejected intent: verification and re-opening review both need a seat
select pg_temp.as_user(1);
select (public.register_for_event(pg_temp.ev('c'))).id is not null;
select (public.submit_payment((pg_temp.reg(1,'c')).id, 'UTRC000001', null)).payment_status = 'under_review';
select pg_temp.as_user(0);
select (public.admin_set_payment_status((pg_temp.reg(1,'c')).id, 'rejected', 'wrong amount')).registration_status = 'rejected';
select pg_temp.as_user(2);
select (public.register_for_event(pg_temp.ev('c'))).id is not null;
select pg_temp.save('c_snap', pg_temp.snapshot('c'));
select pg_temp.as_user(0);
select pg_temp.expect_error(format($q$select public.admin_set_payment_status(%L, 'verified', null)$q$, (pg_temp.reg(1,'c')).id), 'EVENT_FULL_AT_VERIFICATION');
select pg_temp.expect_error(format($q$select public.admin_set_payment_status(%L, 'under_review', null)$q$, (pg_temp.reg(1,'c')).id), 'EVENT_FULL_AT_REVIEW');
select pg_temp.check(pg_temp.snapshot('c') = pg_temp.saved('c_snap'), 'C: refused review changes left rows untouched');
reset role; select pg_temp.expire_reg(2, 'c'); set role authenticated;
select (public.admin_set_payment_status((pg_temp.reg(1,'c')).id, 'verified', null)).registration_status = 'confirmed';
select pg_temp.check(pg_temp.seats('c') = 1, 'C: rejected intent verified once a seat was free');

-- D. Expired team intent must re-acquire its complete size atomically
select pg_temp.as_user(1);
select (public.register_team(pg_temp.ev('t'), array[pg_temp.u(2), pg_temp.u(3)])).id is not null;
reset role; select pg_temp.expire_event('t'); set role authenticated;
select pg_temp.as_user(4);
select (public.register_team(pg_temp.ev('t'), array[pg_temp.u(5)])).id is not null;
select pg_temp.check(pg_temp.seats('t') = 2, 'D: newer team holds 2 of 4 seats');
select pg_temp.save('t_snap', pg_temp.snapshot('t'));
select pg_temp.as_user(0);
select pg_temp.expect_error(format($q$select public.admin_set_payment_status(%L, 'verified', null)$q$, (pg_temp.reg(1,'t')).id), 'EVENT_FULL_AT_VERIFICATION');
select pg_temp.check(pg_temp.snapshot('t') = pg_temp.saved('t_snap'), 'D: no partial team confirmation (all-or-nothing)');
select pg_temp.as_user(4);
select (public.cancel_registration((pg_temp.reg(4,'t')).id)).registration_status = 'cancelled';
select pg_temp.as_user(0);
select (public.admin_set_payment_status((pg_temp.reg(1,'t')).id, 'verified', null)).registration_status = 'confirmed';
reset role;
select pg_temp.check((select count(*) from public.registrations r where r.team_id = (pg_temp.reg(1,'t')).team_id and r.registration_status = 'confirmed') = 3,
  'D: whole team (3) confirmed via cascade');
set role authenticated;
select pg_temp.check(pg_temp.seats('t') = 3, 'D: event now holds exactly the team size');

-- E. Team with an active hold on a full event verifies without extra capacity
select pg_temp.as_user(1);
select (public.register_team(pg_temp.ev('t2'), array[pg_temp.u(2), pg_temp.u(3)])).id is not null;
select pg_temp.check(pg_temp.seats('t2') = 3, 'E: team fills the event');
select pg_temp.as_user(0);
select (public.admin_set_payment_status((pg_temp.reg(2,'t2')).id, 'verified', null)).payment_status = 'verified';
reset role;
select pg_temp.check((select bool_and(registration_status = 'confirmed') from public.registrations where event_id = pg_temp.ev('t2')),
  'E: verifying via a teammate row cascades to the whole team');
set role authenticated;

-- F. Unlimited event: expired intent verifies freely
select pg_temp.as_user(3);
select (public.register_for_event(pg_temp.ev('u'))).id is not null;
reset role; select pg_temp.expire_reg(3, 'u'); set role authenticated;
select pg_temp.as_user(0);
select (public.admin_set_payment_status((pg_temp.reg(3,'u')).id, 'verified', null)).registration_status = 'confirmed';
select pg_temp.check(true, 'F: unlimited event verification unaffected');

-- G. Archived event: payments under review can still be resolved
select pg_temp.as_user(1);
select (public.register_for_event(pg_temp.ev('arc'))).id is not null;
select (public.submit_payment((pg_temp.reg(1,'arc')).id, 'UTRARC0001', null)).payment_status = 'under_review';
select pg_temp.as_user(0);
select public.admin_set_event_archived(pg_temp.ev('arc'), true);
select (public.admin_set_payment_status((pg_temp.reg(1,'arc')).id, 'verified', null)).registration_status = 'confirmed';
select pg_temp.check(true, 'G: archived event payment under review resolved');

-- H. Permission unchanged
select pg_temp.as_user(1);
select pg_temp.expect_error(format($q$select public.admin_set_payment_status(%L, 'verified', null)$q$, (pg_temp.reg(1,'b')).id), 'FORBIDDEN');

reset role;
select 'ALL 0018 TESTS PASSED';
