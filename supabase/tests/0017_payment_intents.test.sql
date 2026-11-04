-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0017_payment_intents: 72-hour holds, frozen prices, capacity, expiry reuse, teams, duplicates, archived payments.
\set ON_ERROR_STOP 1
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;

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
  select ('00000000-0000-0000-0000-0000000001' || lpad(p_n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.ev(p_slug text) returns uuid language sql stable security definer as $$
  select id from public.events where slug = p_slug $$;
create or replace function pg_temp.reg(p_n int, p_slug text) returns public.registrations language sql stable security definer as $$
  select * from public.registrations where profile_id = pg_temp.u(p_n) and event_id = pg_temp.ev(p_slug) $$;
create or replace function pg_temp.seats(p_slug text) returns int language sql stable security definer as $$
  select public.event_seats_taken(pg_temp.ev(p_slug)) $$;
create or replace function pg_temp.q(p_sql text) returns boolean language plpgsql security definer as $$
declare v boolean; begin execute p_sql into v; return v; end $$;
create or replace function pg_temp.as_user(p_n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, false) $$;
create or replace function pg_temp.expire(p_slug text) returns void language sql as $$
  update public.registrations set hold_expires_at = now() - interval '1 minute'
  where event_id = pg_temp.ev(p_slug) $$;

-- users: 100 = admin, 101..106 participants
insert into auth.users (id, email, raw_user_meta_data)
select pg_temp.u(n), 'u'||n||'@x.test', json_build_object('full_name','U'||n)::jsonb
from generate_series(0, 6) n;
update public.profiles set approval_status = 'approved';
update public.profiles set role = 'admin', admin_scopes = array['events','payments'] where id = pg_temp.u(0);

insert into public.events (slug, title, registration_fee, team_fee, registration_open, is_live, team_enabled, team_max, max_participants, discount_enabled, discount_amount) values
 ('p',   'Paid',   10000, 0,     true, true, false, 4, 2,    false, 0),
 ('f',   'Free',   0,     0,     true, true, false, 4, 1,    false, 0),
 ('c',   'Cancel', 5000,  0,     true, true, false, 4, 1,    false, 0),
 ('tm',  'Team',   8000,  20000, true, true, true,  3, 4,    false, 0),
 ('tm2', 'Team2',  8000,  20000, true, true, true,  3, 3,    false, 0),
 ('q',   'Parent', 0,     0,     true, true, false, 4, null, true,  3000),
 ('z',   'Parent2',0,     0,     true, true, false, 4, null, true,  5000);
insert into public.events (slug, title, registration_fee, registration_open, is_live, parent_event_id) values
 ('q1', 'Q1', 5000, true, true, pg_temp.ev('q')),
 ('q2', 'Q2', 5000, true, true, pg_temp.ev('q')),
 ('z1', 'Z1', 5000, true, true, pg_temp.ev('z')),
 ('z2', 'Z2', 5000, true, true, pg_temp.ev('z'));

set role authenticated;

-- 1. Intent creation: pending, unpaid, frozen price, 72 h hold
select pg_temp.as_user(1);
select (public.register_for_event(pg_temp.ev('p'))).id is not null;
select pg_temp.check((select registration_status = 'pending' and payment_status = 'unpaid' and amount = 10000
   and hold_expires_at between now() + interval '71.9 hours' and now() + interval '72.1 hours'
   from pg_temp.reg(1,'p')), 'intent is pending/unpaid with frozen price and 72h hold');

-- 2. Price frozen at intent creation
reset role; update public.events set registration_fee = 15000 where slug = 'p'; set role authenticated;
select pg_temp.as_user(2);
select (public.register_for_event(pg_temp.ev('p'))).amount = 15000 as u2_new_price;
select pg_temp.check((select amount from pg_temp.reg(1,'p')) = 10000, 'earlier intent keeps frozen price after fee change');

-- 3. Holds consume capacity; intents are not confirmed registrations
select pg_temp.as_user(3);
select pg_temp.expect_error($q$select public.register_for_event(pg_temp.ev('p'))$q$, 'EVENT_FULL');
select pg_temp.check((select seats_taken = 2 and confirmed = 0 from public.event_capacity_counts() where event_id = pg_temp.ev('p')),
  'capacity counts: 2 seats held, 0 confirmed');

-- 4. Expired hold frees the seat; expired intent cannot pay; reuse refreshes in place
reset role; update public.registrations set hold_expires_at = now() - interval '1 minute' where id = (pg_temp.reg(2,'p')).id; set role authenticated;
select pg_temp.check(pg_temp.seats('p') = 1, 'expired hold no longer counts');
select pg_temp.as_user(2);
select pg_temp.expect_error(format($q$select public.submit_payment(%L, 'UTR999999', null)$q$, (pg_temp.reg(2,'p')).id), 'HOLD_EXPIRED');
select pg_temp.check((select expired_intent and reusable and not holds_seat from public.my_registration_states() where event_id = pg_temp.ev('p')),
  'my_registration_states reports the expired intent');
select pg_temp.as_user(3);
select (public.register_for_event(pg_temp.ev('p'))).id is not null as u3_takes_freed_seat;
select pg_temp.as_user(2);
select pg_temp.expect_error($q$select public.register_for_event(pg_temp.ev('p'))$q$, 'EVENT_FULL');

-- 5. UTR under review keeps the hold past the 72 h window
select pg_temp.as_user(1);
select (public.submit_payment((pg_temp.reg(1,'p')).id, 'utr111111', 'shot1.png')).payment_status = 'under_review' as u1_under_review;
reset role; update public.registrations set hold_expires_at = now() - interval '1 day' where id = (pg_temp.reg(1,'p')).id; set role authenticated;
select pg_temp.check(pg_temp.seats('p') = 2, 'under-review intent keeps its seat after 72h');

-- 6. Duplicate UTR is detected and does not extend the hold
reset role; create temp table h3 as select hold_expires_at from public.registrations where id = (pg_temp.reg(3,'p')).id; grant all on h3 to authenticated; set role authenticated;
select pg_temp.as_user(3);
select (public.submit_payment((pg_temp.reg(3,'p')).id, 'UTR111111', 'shot3.png')).payment_status = 'duplicate' as u3_duplicate;
select pg_temp.check((select r.duplicate_of = (pg_temp.reg(1,'p')).id and r.hold_expires_at = h.hold_expires_at
   from pg_temp.reg(3,'p') r, h3 h), 'duplicate flagged against first registration; hold not extended');

-- 7. Rejection frees the seat; resubmission must win a seat again
select pg_temp.as_user(0);
select (public.admin_set_payment_status((pg_temp.reg(1,'p')).id, 'rejected', 'bad utr')).registration_status = 'rejected' as u1_rejected;
select pg_temp.check(pg_temp.seats('p') = 1, 'rejected payment releases its seat');
select pg_temp.as_user(2);
select (public.register_for_event(pg_temp.ev('p'))).amount = 15000 as u2_refreshed_at_current_price;
reset role; select pg_temp.check((select count(*) from public.payment_events where registration_id = (pg_temp.reg(2,'p')).id and action = 'intent_refreshed') = 1,
  'refresh reused the same row and was audited'); set role authenticated;
reset role; select pg_temp.check((select count(*) from public.registrations where profile_id = pg_temp.u(2) and event_id = pg_temp.ev('p')) = 1,
  'no duplicate registration row after refresh'); set role authenticated;
select pg_temp.as_user(1);
select pg_temp.expect_error(format($q$select public.submit_payment(%L, 'UTR222222', null)$q$, (pg_temp.reg(1,'p')).id), 'EVENT_FULL');
reset role; update public.registrations set hold_expires_at = now() - interval '1 minute' where id = (pg_temp.reg(3,'p')).id; set role authenticated;
select (public.submit_payment((pg_temp.reg(1,'p')).id, 'UTR222222', null)).registration_status = 'pending' as u1_reacquired_seat;
select pg_temp.check(pg_temp.seats('p') = 2, 'resubmission after rejection re-acquired a seat');

-- 8. Re-uploading during review opens one fresh 72h window
select (public.submit_payment((pg_temp.reg(1,'p')).id, null, 'shot1b.png')).payment_status = 'uploaded' as u1_reupload;
select pg_temp.check((select hold_expires_at > now() + interval '71.9 hours' from pg_temp.reg(1,'p')), 'fresh 72h window after correcting a reviewed submission');
select (public.submit_payment((pg_temp.reg(1,'p')).id, 'UTR333333', null)).payment_status = 'under_review' as u1_resubmitted;

-- 9. Verification confirms; archived events block new submissions but admins can resolve
select pg_temp.as_user(2);
select (public.submit_payment((pg_temp.reg(2,'p')).id, null, 'shot2.png')).payment_status = 'uploaded' as u2_uploaded;
select pg_temp.as_user(0);
select public.admin_set_event_archived(pg_temp.ev('p'), true);
select pg_temp.as_user(2);
select pg_temp.expect_error(format($q$select public.submit_payment(%L, 'UTR444444', null)$q$, (pg_temp.reg(2,'p')).id), 'EVENT_ARCHIVED');
select pg_temp.as_user(0);
select (public.admin_set_payment_status((pg_temp.reg(1,'p')).id, 'verified', null)).registration_status = 'confirmed' as admin_resolves_on_archived;
select pg_temp.check((select verified_by = pg_temp.u(0) and hold_expires_at is null from pg_temp.reg(1,'p')), 'verification recorded, hold cleared');
select pg_temp.as_user(1);
select pg_temp.expect_error(format($q$select public.submit_payment(%L, 'UTR555555', null)$q$, (pg_temp.reg(1,'p')).id), 'EVENT_ARCHIVED');
select pg_temp.as_user(0);
select public.admin_set_event_archived(pg_temp.ev('p'), false);
select pg_temp.as_user(1);
select pg_temp.expect_error(format($q$select public.submit_payment(%L, 'UTR555555', null)$q$, (pg_temp.reg(1,'p')).id), 'ALREADY_PAID');

-- 10. Free registration confirms immediately and takes a seat
select pg_temp.as_user(4);
select (public.register_for_event(pg_temp.ev('f'))).registration_status = 'confirmed' as free_confirmed;
select pg_temp.check((select payment_status = 'verified' and hold_expires_at is null from pg_temp.reg(4,'f')), 'free registration verified, no hold');
select pg_temp.as_user(5);
select pg_temp.expect_error($q$select public.register_for_event(pg_temp.ev('f'))$q$, 'EVENT_FULL');

-- 11. Cancel releases the seat; cancelled row is reusable
select (public.register_for_event(pg_temp.ev('c'))).id is not null as u5_c;
select (public.cancel_registration((pg_temp.reg(5,'c')).id)).registration_status = 'cancelled' as u5_cancelled;
select pg_temp.expect_error(format($q$select public.submit_payment(%L, 'UTR666666', null)$q$, (pg_temp.reg(5,'c')).id), 'REGISTRATION_CANCELLED');
select pg_temp.as_user(6);
select (public.register_for_event(pg_temp.ev('c'))).id is not null as u6_takes_cancelled_seat;
select pg_temp.as_user(5);
select pg_temp.expect_error($q$select public.register_for_event(pg_temp.ev('c'))$q$, 'EVENT_FULL');

-- 12. Teams: atomic capacity, head pays, holds follow the head, cascade on verify
select pg_temp.as_user(1);
select pg_temp.expect_error($q$select public.register_for_event(pg_temp.ev('tm'))$q$, 'TEAM_EVENT');
select (public.register_team(pg_temp.ev('tm'), array[pg_temp.u(5), pg_temp.u(6)])).amount = 20000 as team_head_pays_flat_fee;
select pg_temp.check(pg_temp.seats('tm') = 3, 'team of 3 holds 3 seats');
reset role; select pg_temp.check((select bool_and(amount = 0 and registration_status = 'pending') from public.registrations
   where event_id = pg_temp.ev('tm') and not is_team_head), 'teammates are pending intents with no charge'); set role authenticated;
select pg_temp.as_user(4);
select pg_temp.expect_error(format($q$select public.register_team(pg_temp.ev('tm'), array[%L::uuid])$q$, pg_temp.u(2)), 'EVENT_FULL');
reset role; select pg_temp.check((select count(*) from public.registrations where event_id = pg_temp.ev('tm')) = 3
   and (select count(*) from public.teams where event_id = pg_temp.ev('tm')) = 1, 'failed team registration left no rows'); set role authenticated;
select pg_temp.as_user(5);
select pg_temp.expect_error(format($q$select public.submit_payment(%L, 'UTR777777', null)$q$, (pg_temp.reg(5,'tm')).id), 'TEAM_HEAD_PAYS');
select pg_temp.as_user(1);
select (public.submit_payment((pg_temp.reg(1,'tm')).id, 'UTR777777', null)).payment_status = 'under_review' as team_under_review;
reset role; select pg_temp.expire('tm'); set role authenticated;
select pg_temp.check(pg_temp.seats('tm') = 3, 'teammates keep seats while head payment is under review');
select pg_temp.as_user(0);
select (public.admin_set_payment_status((pg_temp.reg(1,'tm')).id, 'verified', null)).payment_status = 'verified' as team_verified;
reset role; select pg_temp.check((select bool_and(registration_status = 'confirmed' and payment_status = 'verified') from public.registrations
   where event_id = pg_temp.ev('tm')), 'verification cascades to the whole team'); set role authenticated;
select pg_temp.check((select confirmed = 3 from public.event_capacity_counts() where event_id = pg_temp.ev('tm')), 'team counted as 3 confirmed');

-- 13. Expired team intents: teammates' rows are reused by a new team
select pg_temp.as_user(2);
select (public.register_team(pg_temp.ev('tm2'), array[pg_temp.u(4)])).id is not null as team2_created;
reset role; select pg_temp.expire('tm2'); set role authenticated;
select pg_temp.check(pg_temp.seats('tm2') = 0, 'expired team intent frees all seats');
select pg_temp.as_user(4);
select (public.register_team(pg_temp.ev('tm2'), array[pg_temp.u(3), pg_temp.u(6)])).is_team_head as u4_new_head;
reset role; select pg_temp.check((select count(*) from public.registrations where profile_id = pg_temp.u(4) and event_id = pg_temp.ev('tm2')) = 1,
  'expired teammate row reused, not duplicated'); set role authenticated;
select pg_temp.check(pg_temp.seats('tm2') = 3, 'new team holds 3 seats');
select pg_temp.as_user(2);
select pg_temp.check((select expired_intent and reusable from public.my_registration_states() where event_id = pg_temp.ev('tm2')),
  'old head remains an expired, reusable intent');
select pg_temp.expect_error($q$select public.register_team(pg_temp.ev('tm2'), array[]::uuid[])$q$, 'EVENT_FULL');

-- 14. Discounts still follow the ancestor chain; fully discounted confirms immediately
select pg_temp.as_user(3);
select (public.register_for_event(pg_temp.ev('q1'))).amount = 5000 as q1_full_price;
select (public.register_for_event(pg_temp.ev('z1'))).amount = 5000 as z1_full_price;
select pg_temp.as_user(0);
select public.admin_set_payment_status((pg_temp.reg(3,'q1')).id, 'verified', null) is not null;
select public.admin_set_payment_status((pg_temp.reg(3,'z1')).id, 'verified', null) is not null;
select pg_temp.as_user(3);
select (public.register_for_event(pg_temp.ev('q2'))).amount = 2000 as q2_discounted;
select pg_temp.check((select registration_status = 'confirmed' and payment_status = 'verified' and amount = 0
   from public.register_for_event(pg_temp.ev('z2'))), 'fully discounted registration confirms immediately');

-- 15. Grants: public aggregate is callable by anon; internals are not
reset role; set role anon;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.check((select count(*) > 0 from public.event_capacity_counts()), 'anon can read aggregate capacity counts');
select pg_temp.expect_error($q$select public.event_seats_taken(pg_temp.ev('p'))$q$, 'permission denied');
select pg_temp.expect_error($q$select public.registration_blocks_new(pg_temp.u(1), pg_temp.ev('p'))$q$, 'permission denied');
reset role; set role service_role;
select pg_temp.check(public.registration_blocks_new(pg_temp.u(1), pg_temp.ev('tm')) and not public.registration_blocks_new(pg_temp.u(2), pg_temp.ev('tm2')),
  'service-role teammate check: live blocks, expired does not');
reset role;
select 'ALL 0017 TESTS PASSED';
