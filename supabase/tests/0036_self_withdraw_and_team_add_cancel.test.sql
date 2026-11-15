-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0036 (D-029): participant withdrawal of a genuinely unpaid intent
-- (cancel_my_registration: solo, team-head cascade, non-head refused, every
-- evidence/confirmed state refused) and team-add absorption of an eligible
-- SOLO unpaid intent (no team, or head of a team of exactly one) by
-- register_team / edit_team_roster, with capacity counted once.
\set ON_ERROR_STOP 1
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;

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
  select ('00000000-0000-0000-0000-0000000036' || lpad(p_n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.ev(p_slug text) returns uuid language sql stable security definer as $$
  select id from public.events where slug = p_slug $$;
create or replace function pg_temp.reg(p_n int, p_slug text) returns public.registrations language sql stable security definer as $$
  select * from public.registrations where profile_id = pg_temp.u(p_n) and event_id = pg_temp.ev(p_slug) $$;
create or replace function pg_temp.seats(p_slug text) returns int language sql stable security definer as $$
  select public.event_seats_taken(pg_temp.ev(p_slug)) $$;
create or replace function pg_temp.team_rows(p_n int, p_slug text) returns text language sql stable security definer as $$
  select string_agg(right(profile_id::text, 2) || ':' || registration_status || ':' || payment_status
                    || ':' || (hold_expires_at is null), ',' order by profile_id)
  from public.registrations where team_id = (pg_temp.reg(p_n, p_slug)).team_id $$;
create or replace function pg_temp.events_for(p_id uuid, p_action text) returns int language sql stable security definer as $$
  select count(*)::int from public.payment_events where registration_id = p_id and action = p_action $$;
create or replace function pg_temp.snap(p_n int, p_slug text) returns text language sql stable security definer as $$
  select row_to_json(r)::text from public.registrations r where profile_id = pg_temp.u(p_n) and event_id = pg_temp.ev(p_slug) $$;
create or replace function pg_temp.as_user(p_n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, false) $$;
create temp table saved (k text primary key, v text);
grant all on saved to authenticated, anon;
create or replace function pg_temp.save(p_k text, p_v text) returns void language sql as $$
  insert into saved values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create or replace function pg_temp.saved(p_k text) returns text language sql as $$ select v from saved where k = p_k $$;

-- users 00 events/payments admin, 01..29 approved participants
insert into auth.users (id, email, raw_user_meta_data)
select pg_temp.u(n), 'w'||n||'@x.test', json_build_object('full_name','W'||n)::jsonb from generate_series(0, 29) n;
update public.profiles set approval_status = 'approved';
update public.profiles set role = 'admin', admin_scopes = array['events','payments'] where id = pg_temp.u(0);

insert into public.events (slug, title, registration_fee, team_fee, registration_open, is_live, team_enabled, team_max, max_participants) values
  ('s',    'Solo',        10000,     0, true, true, false, 4, null),
  ('t',    'Team',        10000, 20000, true, true, true,  4, null),
  ('cap',  'Capacity',    10000, 20000, true, true, true,  3, 3),
  ('cap2', 'Capacity 2',  10000, 20000, true, true, true,  3, 3);

-- ── 0. privileges ──────────────────────────────────────────────────────────
select pg_temp.check(has_function_privilege('authenticated', 'public.cancel_my_registration(uuid)', 'execute'), '0: authenticated may withdraw');
select pg_temp.check(not has_function_privilege('anon', 'public.cancel_my_registration(uuid)', 'execute'), '0: anon may not withdraw');
select pg_temp.check(not has_function_privilege('authenticated', 'public.cancel_registration(uuid)', 'execute')
                 and not has_function_privilege('anon', 'public.cancel_registration(uuid)', 'execute'),
  '0: the legacy unlocked cancel_registration is no longer callable by clients');
select pg_temp.check(not has_function_privilege('authenticated', 'public.registration_blocks_team_add(uuid, uuid, uuid)', 'execute')
                 and has_function_privilege('service_role', 'public.registration_blocks_team_add(uuid, uuid, uuid)', 'execute'),
  '0: team-add lookup predicate is server-only');
select pg_temp.check(not has_function_privilege('authenticated', 'public.registration_withdrawable(public.registrations)', 'execute')
                 and not has_function_privilege('authenticated', 'public.registration_absorbable(public.registrations)', 'execute'),
  '0: eligibility helpers are internal');

-- ── A. solo withdrawal releases the seat ───────────────────────────────────
set role authenticated;
select pg_temp.as_user(1);
select (public.register_for_event(pg_temp.ev('s'))).registration_status = 'pending' as a_registered;
reset role;
select pg_temp.save('a_id', (pg_temp.reg(1,'s')).id::text);
select pg_temp.check(pg_temp.seats('s') = 1, 'A: the unpaid intent holds a seat');
set role authenticated;
select pg_temp.as_user(2);
select pg_temp.expect_error(format($q$select public.cancel_my_registration(%L)$q$, pg_temp.saved('a_id')), 'REGISTRATION_NOT_FOUND');
select pg_temp.expect_error($q$select public.cancel_my_registration(gen_random_uuid())$q$, 'REGISTRATION_NOT_FOUND');
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect_error(format($q$select public.cancel_my_registration(%L)$q$, pg_temp.saved('a_id')), 'AUTH_REQUIRED');
select pg_temp.as_user(1);
select pg_temp.check((public.cancel_my_registration(pg_temp.saved('a_id')::uuid)).registration_status = 'cancelled', 'A: owner withdraws the unpaid intent');
reset role;
select pg_temp.check((select registration_status = 'cancelled' and payment_status = 'unpaid' and hold_expires_at is null
                      from pg_temp.reg(1,'s')), 'A: row cancelled, still unpaid, hold cleared');
select pg_temp.check(pg_temp.seats('s') = 0, 'A: seat released');
select pg_temp.check((select count(*) = 1 from public.payment_events where registration_id = pg_temp.saved('a_id')::uuid
                        and action = 'intent_withdrawn' and actor_id = pg_temp.u(1)
                        and from_status = 'unpaid' and to_status = 'unpaid'
                        and note not like '%@%' and note not like '%' || pg_temp.u(1)::text || '%'),
  'A: one PII-free audit entry by the owner');
set role authenticated;
select pg_temp.as_user(1);
select pg_temp.expect_error(format($q$select public.cancel_my_registration(%L)$q$, pg_temp.saved('a_id')), 'NOT_CANCELLABLE');
select pg_temp.check((public.register_for_event(pg_temp.ev('s'))).id = pg_temp.saved('a_id')::uuid, 'A: registering again reuses the same row');
reset role;
set role anon;
select pg_temp.expect_error(format($q$select public.cancel_my_registration(%L)$q$, pg_temp.saved('a_id')), 'permission denied');
reset role;

-- ── B. every non-eligible state is refused and left untouched ──────────────
set role authenticated;
select pg_temp.as_user(n), (public.register_for_event(pg_temp.ev('s'))).id is not null from generate_series(3, 10) n;
reset role;
update public.registrations set payment_status = 'uploaded', payment_screenshot = 'p/3.png' where id = (pg_temp.reg(3,'s')).id;
update public.registrations set payment_status = 'under_review' where id = (pg_temp.reg(4,'s')).id;
update public.registrations set registration_status = 'confirmed', payment_status = 'verified', hold_expires_at = null where id = (pg_temp.reg(5,'s')).id;
update public.registrations set transaction_id = 'UTR36000006' where id = (pg_temp.reg(6,'s')).id;
update public.registrations set payment_status = 'duplicate' where id = (pg_temp.reg(7,'s')).id;
update public.registrations set registration_status = 'rejected', payment_status = 'rejected' where id = (pg_temp.reg(8,'s')).id;
update public.registrations set duplicate_of = (pg_temp.reg(1,'s')).id where id = (pg_temp.reg(9,'s')).id;
update public.registrations set payment_screenshot = 'p/10.png' where id = (pg_temp.reg(10,'s')).id;   -- unpaid but evidence
select pg_temp.save('b_' || n, pg_temp.snap(n, 's')) from generate_series(3, 10) n;
select pg_temp.save('b_audit', (select count(*)::text from public.payment_events));
set role authenticated;
select pg_temp.as_user(n), pg_temp.expect_error(format($q$select public.cancel_my_registration(%L)$q$, (pg_temp.reg(n,'s')).id), 'NOT_CANCELLABLE')
from generate_series(3, 10) n;
reset role;
select pg_temp.check(bool_and(pg_temp.snap(n, 's') = pg_temp.saved('b_' || n)), 'B: uploaded/under_review/confirmed/UTR/duplicate/rejected/duplicate-link/screenshot rows unchanged')
from generate_series(3, 10) n;
select pg_temp.check((select count(*)::text from public.payment_events) = pg_temp.saved('b_audit'), 'B: refusals write no audit');

-- ── C. team head cascades; non-head is refused ─────────────────────────────
set role authenticated;
select pg_temp.as_user(1);
select (public.register_team(pg_temp.ev('t'), array[pg_temp.u(2), pg_temp.u(3)], 'Alpha')).id is not null as c_team;
reset role;
select pg_temp.check(pg_temp.seats('t') = 3, 'C: team of three holds three seats');
select pg_temp.save('c_rows', pg_temp.team_rows(1, 't'));
set role authenticated;
select pg_temp.as_user(2);
select pg_temp.expect_error(format($q$select public.cancel_my_registration(%L)$q$, (pg_temp.reg(2,'t')).id), 'NOT_TEAM_HEAD');
select pg_temp.expect_error(format($q$select public.cancel_my_registration(%L)$q$, (pg_temp.reg(1,'t')).id), 'REGISTRATION_NOT_FOUND');
reset role;
select pg_temp.check(pg_temp.team_rows(1, 't') = pg_temp.saved('c_rows'), 'C: non-head attempts change nothing');
set role authenticated;
select pg_temp.as_user(1);
select pg_temp.check((public.cancel_my_registration((pg_temp.reg(1,'t')).id)).is_team_head, 'C: head withdrawal returns the head row');
reset role;
select pg_temp.check(pg_temp.team_rows(1, 't') = '01:cancelled:unpaid:true,02:cancelled:unpaid:true,03:cancelled:unpaid:true',
  'C: every team row cancelled, holds cleared');
select pg_temp.check(pg_temp.seats('t') = 0, 'C: all three seats released');
select pg_temp.check((select count(*) = 3 and count(distinct registration_id) = 3 and bool_and(actor_id = pg_temp.u(1))
                      from public.payment_events where action = 'team_intent_withdrawn'
                        and registration_id in (select id from public.registrations where team_id = (pg_temp.reg(1,'t')).team_id)),
  'C: one audit entry per affected registration');
-- evidence on the head locks the whole team
set role authenticated;
select pg_temp.as_user(4);
select (public.register_team(pg_temp.ev('t'), array[pg_temp.u(5)], 'Beta')).id is not null as c_beta;
select pg_temp.check((public.submit_payment((pg_temp.reg(4,'t')).id, 'UTR36444444', 'p/beta.png')).payment_status = 'under_review', 'C: Beta payment submitted');
reset role;
select pg_temp.save('c_beta', pg_temp.team_rows(4, 't'));
set role authenticated;
select pg_temp.expect_error(format($q$select public.cancel_my_registration(%L)$q$, (pg_temp.reg(4,'t')).id), 'NOT_CANCELLABLE');
select pg_temp.as_user(5);
select pg_temp.expect_error(format($q$select public.cancel_my_registration(%L)$q$, (pg_temp.reg(5,'t')).id), 'NOT_TEAM_HEAD');
reset role;
select pg_temp.check(pg_temp.team_rows(4, 't') = pg_temp.saved('c_beta'), 'C: a team with payment evidence is never withdrawn');

-- ── D. register_team absorbs an eligible solo intent ───────────────────────
set role authenticated;
select pg_temp.as_user(6);
select (public.register_team(pg_temp.ev('t'), array[]::uuid[], null)).id is not null as d_solo;   -- team of one
reset role;
select pg_temp.save('d_id', (pg_temp.reg(6,'t')).id::text);
select pg_temp.save('d_seats', pg_temp.seats('t')::text);
set role authenticated;
select pg_temp.as_user(7);
select (public.register_team(pg_temp.ev('t'), array[pg_temp.u(6)], 'Gamma')).id is not null as d_gamma;
reset role;
select pg_temp.check((select id = pg_temp.saved('d_id')::uuid and not is_team_head and team_id = (pg_temp.reg(7,'t')).team_id
                        and registration_status = 'pending' and payment_status = 'unpaid' and amount = 0
                      from pg_temp.reg(6,'t')), 'D: the solo row is reused (same id) as a member of the new team');
select pg_temp.check(pg_temp.events_for(pg_temp.saved('d_id')::uuid, 'solo_intent_absorbed') = 1, 'D: distinguishing audit entry');
select pg_temp.check((select note not like '%' || pg_temp.u(7)::text || '%' and note not like '%@%' from public.payment_events
                      where registration_id = pg_temp.saved('d_id')::uuid and action = 'solo_intent_absorbed'), 'D: audit note is PII-free');
select pg_temp.check(pg_temp.seats('t') = pg_temp.saved('d_seats')::int + 1, 'D: only the new head adds a seat (absorbed seat not double-counted)');
-- a plain (team-less) solo row is absorbed too
insert into public.registrations (profile_id, event_id, amount, registration_status, payment_status, hold_expires_at)
values (pg_temp.u(20), pg_temp.ev('t'), 10000, 'pending', 'unpaid', now() + interval '72 hours');
select pg_temp.save('d_plain', (pg_temp.reg(20,'t')).id::text);
set role authenticated;
select pg_temp.as_user(21);
select (public.register_team(pg_temp.ev('t'), array[pg_temp.u(20)], 'Plain')).id is not null as d_plain_team;
reset role;
select pg_temp.check((select id = pg_temp.saved('d_plain')::uuid and team_id = (pg_temp.reg(21,'t')).team_id from pg_temp.reg(20,'t')),
  'D: a team-less unpaid intent is absorbed with the same id');

-- ── E. other teams, evidence and confirmed rows stay blocked ───────────────
set role authenticated;
select pg_temp.as_user(8);
select (public.register_team(pg_temp.ev('t'), array[pg_temp.u(9)], 'Delta')).id is not null as e_delta;
select pg_temp.as_user(11);
select (public.register_team(pg_temp.ev('t'), array[]::uuid[], null)).id is not null as e_solo11;
select pg_temp.check((public.submit_payment((pg_temp.reg(11,'t')).id, 'UTR36111111', 'p/11.png')).payment_status = 'under_review', 'E: solo 11 payment submitted');
select pg_temp.as_user(12);
select (public.register_team(pg_temp.ev('t'), array[]::uuid[], null)).id is not null as e_solo12;
select pg_temp.as_user(22);
select (public.register_team(pg_temp.ev('t'), array[]::uuid[], null)).id is not null as e_solo22;
reset role;
update public.registrations set registration_status = 'confirmed', payment_status = 'verified', hold_expires_at = null where id = (pg_temp.reg(12,'t')).id;
select pg_temp.save('e_' || n, pg_temp.snap(n, 't')) from unnest(array[8, 9, 11, 12, 22]) n;
set role authenticated;
select pg_temp.as_user(10);
select pg_temp.expect_error(format($q$select public.register_team(pg_temp.ev('t'), array[%L]::uuid[], 'Eps')$q$, pg_temp.u(9)), 'MEMBER_ALREADY_REGISTERED');
select pg_temp.expect_error(format($q$select public.register_team(pg_temp.ev('t'), array[%L]::uuid[], 'Eps')$q$, pg_temp.u(8)), 'MEMBER_ALREADY_REGISTERED');
select pg_temp.expect_error(format($q$select public.register_team(pg_temp.ev('t'), array[%L]::uuid[], 'Eps')$q$, pg_temp.u(11)), 'MEMBER_ALREADY_REGISTERED');
select pg_temp.expect_error(format($q$select public.register_team(pg_temp.ev('t'), array[%L]::uuid[], 'Eps')$q$, pg_temp.u(12)), 'MEMBER_ALREADY_REGISTERED');
-- an eligible solo next to a blocked person: all-or-nothing
select pg_temp.expect_error(format($q$select public.register_team(pg_temp.ev('t'), array[%L, %L]::uuid[], 'Eps')$q$, pg_temp.u(22), pg_temp.u(9)), 'MEMBER_ALREADY_REGISTERED');
-- the head's own solo intent is not absorbed into their new team
select pg_temp.as_user(22);
select pg_temp.expect_error(format($q$select public.register_team(pg_temp.ev('t'), array[%L]::uuid[], 'Own')$q$, pg_temp.u(23)), 'MEMBER_ALREADY_REGISTERED');
reset role;
select pg_temp.check(bool_and(pg_temp.snap(n, 't') = pg_temp.saved('e_' || n)), 'E: blocked people (team of two head/member, evidence, confirmed, refused solo) unchanged')
from unnest(array[8, 9, 11, 12, 22]) n;
select pg_temp.check((pg_temp.reg(10,'t')).id is null, 'E: refused registrations create no rows');
-- banned solo intent is not absorbed
set role authenticated;
select pg_temp.as_user(24);
select (public.register_team(pg_temp.ev('t'), array[]::uuid[], null)).id is not null as e_solo24;
reset role;
insert into public.profile_bans (profile_id, reason) values (pg_temp.u(24), 'test');
select pg_temp.save('e_24', pg_temp.snap(24, 't'));
set role authenticated;
select pg_temp.as_user(25);
select pg_temp.expect_error(format($q$select public.register_team(pg_temp.ev('t'), array[%L]::uuid[], 'Ban')$q$, pg_temp.u(24)), 'MEMBER_BANNED');
reset role;
select pg_temp.check(pg_temp.snap(24, 't') = pg_temp.saved('e_24'), 'E: a banned participant''s intent is never absorbed');

-- ── F. edit_team_roster absorbs too ────────────────────────────────────────
set role authenticated;
select pg_temp.as_user(13);
select (public.register_team(pg_temp.ev('t'), array[pg_temp.u(14)], 'Zeta')).id is not null as f_zeta;
select pg_temp.as_user(15);
select (public.register_team(pg_temp.ev('t'), array[]::uuid[], null)).id is not null as f_solo;
reset role;
select pg_temp.save('f_id', (pg_temp.reg(15,'t')).id::text);
select pg_temp.save('f_seats', pg_temp.seats('t')::text);
set role authenticated;
select pg_temp.as_user(13);
select pg_temp.expect_error(format($q$select public.edit_team_roster(%L, array[%L, %L]::uuid[], 'Zeta')$q$, (pg_temp.reg(13,'t')).id, pg_temp.u(14), pg_temp.u(9)), 'MEMBER_ALREADY_REGISTERED');
select pg_temp.expect_error(format($q$select public.edit_team_roster(%L, array[%L, %L]::uuid[], 'Zeta')$q$, (pg_temp.reg(13,'t')).id, pg_temp.u(14), pg_temp.u(8)), 'MEMBER_ALREADY_REGISTERED');
select pg_temp.check((public.edit_team_roster((pg_temp.reg(13,'t')).id, array[pg_temp.u(14), pg_temp.u(15)], 'Zeta')).id is not null, 'F: head adds an eligible solo');
reset role;
select pg_temp.check((select id = pg_temp.saved('f_id')::uuid and not is_team_head and team_id = (pg_temp.reg(13,'t')).team_id and amount = 0
                      from pg_temp.reg(15,'t')), 'F: the solo row is reused as a member of the edited team');
select pg_temp.check(pg_temp.events_for(pg_temp.saved('f_id')::uuid, 'solo_intent_absorbed') = 1, 'F: distinguishing audit entry');
select pg_temp.check(pg_temp.seats('t') = pg_temp.saved('f_seats')::int, 'F: absorbing a held seat adds no seat');

-- ── G. exact capacity: the absorbed seat is the same seat ──────────────────
set role authenticated;
select pg_temp.as_user(n), (public.register_team(pg_temp.ev('cap'), array[]::uuid[], null)).id is not null from generate_series(16, 17) n;
reset role;
select pg_temp.check(pg_temp.seats('cap') = 2, 'G: two solo holds of three seats');
set role authenticated;
select pg_temp.as_user(18);
select pg_temp.check((public.register_team(pg_temp.ev('cap'), array[pg_temp.u(16), pg_temp.u(17)], 'Cap')).id is not null,
  'G: a team of three absorbing both solos fits exactly');
reset role;
select pg_temp.check(pg_temp.seats('cap') = 3, 'G: exactly at capacity, not over');
set role authenticated;
select pg_temp.as_user(19);
select pg_temp.expect_error($q$select public.register_team(pg_temp.ev('cap'), array[]::uuid[], null)$q$, 'EVENT_FULL');
-- edit: team of two + one solo at max 3; adding the solo fits exactly
select pg_temp.as_user(26);
select (public.register_team(pg_temp.ev('cap2'), array[pg_temp.u(27)], 'Two')).id is not null as g_two;
select pg_temp.as_user(28);
select (public.register_team(pg_temp.ev('cap2'), array[]::uuid[], null)).id is not null as g_solo;
select pg_temp.as_user(26);
select pg_temp.check((public.edit_team_roster((pg_temp.reg(26,'cap2')).id, array[pg_temp.u(27), pg_temp.u(28)], 'Two')).id is not null,
  'G: edit absorbing a held seat at full capacity succeeds');
reset role;
select pg_temp.check(pg_temp.seats('cap2') = 3, 'G: edit keeps exactly three seats');
set role authenticated;
select pg_temp.as_user(29);
select (public.register_for_event(pg_temp.ev('s'))).id is not null as g_other;
reset role;

-- ── H. lookup predicate mirrors the RPC rule; registration_blocks_new unchanged ─
set role authenticated;
select pg_temp.as_user(23);
select (public.register_team(pg_temp.ev('t'), array[]::uuid[], null)).id is not null as h_solo;
reset role;
select pg_temp.check(not public.registration_blocks_team_add(pg_temp.u(23), pg_temp.ev('t'), null), 'H: an eligible solo can be added');
select pg_temp.check(public.registration_blocks_new(pg_temp.u(23), pg_temp.ev('t')), 'H: registration_blocks_new still reports the live hold');
select pg_temp.check(public.registration_blocks_team_add(pg_temp.u(9), pg_temp.ev('t'), null)
                 and public.registration_blocks_team_add(pg_temp.u(8), pg_temp.ev('t'), null)
                 and public.registration_blocks_team_add(pg_temp.u(11), pg_temp.ev('t'), null)
                 and public.registration_blocks_team_add(pg_temp.u(12), pg_temp.ev('t'), null)
                 and public.registration_blocks_team_add(pg_temp.u(24), pg_temp.ev('t'), null),
  'H: team-of-two head/member, evidence, confirmed and banned stay blocked');
select pg_temp.check(not public.registration_blocks_team_add(pg_temp.u(14), pg_temp.ev('t'), (pg_temp.reg(13,'t')).team_id),
  'H: own team members do not block an edit');
