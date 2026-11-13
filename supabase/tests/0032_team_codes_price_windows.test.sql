-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0032: team registration codes; early bird / late bird / on spot pricing.
\set ON_ERROR_STOP 1
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
\ir ../migrations/0032_team_codes_price_windows.sql

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
  select ('00000000-0000-0000-0000-0000000033' || lpad(p_n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.as_user(p_n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, false) $$;
create or replace function pg_temp.ev(p_slug text) returns uuid language sql stable security definer as $$
  select id from public.events where slug = p_slug $$;
create or replace function pg_temp.reg(p_n int, p_slug text) returns public.registrations language sql stable security definer as $$
  select * from public.registrations where profile_id = pg_temp.u(p_n) and event_id = pg_temp.ev(p_slug) $$;
create or replace function pg_temp.code(p_n int, p_slug text) returns text language sql stable security definer as $$
  select code from public.teams where id = (pg_temp.reg(p_n, p_slug)).team_id $$;
create or replace function pg_temp.win(p jsonb) returns void language sql as $$
  select public.admin_set_event_price_windows(pg_temp.ev('t'), p) $$;

insert into auth.users (id, email, raw_user_meta_data)
select pg_temp.u(n), 'w'||n||'@x.test', json_build_object('full_name','W'||n)::jsonb from generate_series(0, 12) n;
update public.profiles set approval_status = 'approved';
update public.profiles set role = 'admin', admin_scopes = array['events'] where id = pg_temp.u(0);
update public.profiles set role = 'admin', admin_scopes = array['payments'] where id = pg_temp.u(1);
insert into public.events (slug, title, registration_fee, team_fee, registration_open, is_live, team_enabled, team_max, event_date) values
  ('t', 'Team', 10000, 30000, true, true, true, 4, (now() at time zone 'Asia/Kolkata')::date + 10),
  ('s', 'Solo', 5000, 0, true, true, false, 1, (now() at time zone 'Asia/Kolkata')::date);

-- ── 1. team codes ──────────────────────────────────────────────────────────
set role authenticated;
select pg_temp.as_user(2);
select public.register_team(pg_temp.ev('t'), array[]::uuid[], null);           -- solo: no code
select pg_temp.as_user(3);
select public.register_team(pg_temp.ev('t'), array[pg_temp.u(4), pg_temp.u(5)], 'Alpha');
select pg_temp.as_user(6);
select public.register_team(pg_temp.ev('t'), array[pg_temp.u(7)], 'Beta');
reset role;
select pg_temp.check(pg_temp.code(2, 't') is null, '1: a one-person team has no team code');
select pg_temp.check(pg_temp.code(3, 't') = 'W27/T/0001' and pg_temp.code(6, 't') = 'W27/T/0002'
  and pg_temp.code(4, 't') = pg_temp.code(3, 't'), '1: teams get sequential codes shared by every member');
-- a solo team that grows gets the next code; a team that shrinks keeps its code
set role authenticated;
select pg_temp.as_user(2);
select public.edit_team_roster((pg_temp.reg(2, 't')).id, array[pg_temp.u(8)], 'Gamma');
select pg_temp.as_user(3);
select public.edit_team_roster((pg_temp.reg(3, 't')).id, array[]::uuid[], null);
reset role;
select pg_temp.check(pg_temp.code(2, 't') = 'W27/T/0003' and pg_temp.code(3, 't') = 'W27/T/0001',
  '1: codes are allocated when a team reaches two members and never change');
set role authenticated;
select pg_temp.as_user(3);
update public.teams set code = 'W27/T/0999' where head_profile_id = auth.uid();   -- RLS: no client writes
reset role;
select pg_temp.check(pg_temp.code(3, 't') = 'W27/T/0001', '1: clients can''t change a team code');
create or replace function pg_temp.as_client_set_code() returns text language plpgsql as $$
begin
  set local role authenticated;
  perform pg_temp.as_user(3);
  update public.teams set code = 'W27/T/0998' where id = (pg_temp.reg(3, 't')).team_id;
  if not found then return 'no row'; end if;
  return 'no error';
exception when others then return sqlerrm; end $$;
grant update on public.teams to authenticated;
drop policy if exists tmp_all on public.teams;
create policy tmp_all on public.teams for update using (true);
begin;
create temp table dbg (r text);
grant all on dbg to authenticated;
insert into dbg select pg_temp.as_client_set_code();
reset role;
select pg_temp.check((select r from dbg) = 'TEAM_CODE_READ_ONLY', '1: even with an update policy the code is read-only to clients: ' || (select r from dbg));
rollback;
drop policy tmp_all on public.teams;
select pg_temp.expect_error($q$update public.teams set code = 'T1' where code = 'W27/T/0001'$q$, 'teams_code_format');
select pg_temp.check((select next_number = 4 from public.team_code_counter), '1: counter is gap-free');
set role anon;
select pg_temp.expect_error($q$select * from public.team_code_counter$q$, 'permission denied');
reset role;

-- ── 2. windows: admin RPC validation ───────────────────────────────────────
set role authenticated;
select pg_temp.as_user(1);
select pg_temp.expect_error($q$select pg_temp.win('[]')$q$, 'FORBIDDEN');
select pg_temp.as_user(0);
select pg_temp.expect_error($q$select pg_temp.win('[{"kind":"happy_hour","adjustment":100}]')$q$, 'INVALID_PRICE_WINDOW');
select pg_temp.expect_error($q$select pg_temp.win('[{"kind":"early_bird","adjustment":150,"starts_at":"2026-01-01T00:00:00+05:30","ends_at":"2026-01-02T00:00:00+05:30"}]')$q$, 'adjustment');
select pg_temp.expect_error($q$select pg_temp.win('[{"kind":"early_bird","adjustment":100,"starts_at":"2026-01-02T00:00:00+05:30","ends_at":"2026-01-01T00:00:00+05:30"}]')$q$, 'dates');
select pg_temp.expect_error($q$select pg_temp.win('[{"kind":"early_bird","adjustment":100,"starts_at":"nope","ends_at":"2026-01-01T00:00:00+05:30"}]')$q$, 'dates');
select pg_temp.expect_error($q$select pg_temp.win('[{"kind":"on_spot","adjustment":100},{"kind":"on_spot","adjustment":200}]')$q$, 'INVALID_PRICE_WINDOW');
select pg_temp.expect_error(format($q$select pg_temp.win(%L)$q$, jsonb_build_array(
  jsonb_build_object('kind','early_bird','adjustment',-2000,'starts_at',now() - interval '1 day','ends_at',now() + interval '2 days'),
  jsonb_build_object('kind','late_bird','adjustment',100,'starts_at',now() + interval '1 day','ends_at',now() + interval '3 days'))), 'PRICE_WINDOWS_OVERLAP');
select pg_temp.expect_error($q$insert into public.event_pricing_windows values (pg_temp.ev('t'), 'on_spot', null, null, 100)$q$, 'permission denied');

-- ── 3. prices: early bird active now (−₹20 per person) ─────────────────────
select pg_temp.win(jsonb_build_array(
  jsonb_build_object('kind','early_bird','adjustment',-2000,'starts_at',now() - interval '1 day','ends_at',now() + interval '1 day'),
  jsonb_build_object('kind','late_bird','adjustment',100,'starts_at',now() + interval '5 days','ends_at',now() + interval '6 days'),
  jsonb_build_object('kind','on_spot','adjustment',5000)));
reset role;
select pg_temp.check((select kind = 'early_bird' and adjustment = -2000 from public.event_price_window(pg_temp.ev('t'))), '3: early bird is active');
select pg_temp.check((select list_price = 30000 - 3 * 2000 from public.event_offer_price(pg_temp.u(9), pg_temp.ev('t'), 3)),
  '3: early bird applies per person (team of 3: ₹300 − 3×₹20)');
select pg_temp.check((select kind = 'late_bird' from public.event_price_window(pg_temp.ev('t'), now() + interval '5 days 1 hour')),
  '3: late bird in its window');
select pg_temp.check((select count(*) = 0 from public.event_price_window(pg_temp.ev('t'), now() + interval '3 days')),
  '3: normal price between windows');
select pg_temp.check((select kind = 'on_spot' from public.event_price_window(pg_temp.ev('t'),
  ((((now() at time zone 'Asia/Kolkata')::date + 10)::timestamp + interval '9 hours') at time zone 'Asia/Kolkata'))),
  '3: on spot on the event date (IST)');
-- on spot beats a late-bird window that covers the event day
reset role;
update public.event_pricing_windows set starts_at = now() + interval '9 days', ends_at = now() + interval '12 days'
  where event_id = pg_temp.ev('t') and kind = 'late_bird';
select pg_temp.check((select kind = 'on_spot' from public.event_price_window(pg_temp.ev('t'),
  ((((now() at time zone 'Asia/Kolkata')::date + 10)::timestamp + interval '12 hours') at time zone 'Asia/Kolkata'))),
  '3: on spot overrides late bird on the event day');
-- registering now freezes the early-bird price
set role authenticated;
select pg_temp.as_user(9);
select public.register_team(pg_temp.ev('t'), array[pg_temp.u(10), pg_temp.u(11)], 'Delta');
reset role;
select pg_temp.check((pg_temp.reg(9, 't')).amount = 24000 and (pg_temp.reg(9, 't')).list_price = 24000, '3: early-bird price frozen on the intent');
update public.event_pricing_windows set adjustment = 9900 where event_id = pg_temp.ev('t') and kind = 'early_bird';
select pg_temp.check((pg_temp.reg(9, 't')).amount = 24000, '3: later price changes never touch an existing intent');
-- solo event on its own date: on spot (+₹10)
set role authenticated;
select pg_temp.as_user(0);
select public.admin_set_event_price_windows(pg_temp.ev('s'), '[{"kind":"on_spot","adjustment":1000}]');
select pg_temp.as_user(12);
select (public.register_for_event(pg_temp.ev('s'))).amount = 6000;
reset role;
select pg_temp.check((pg_temp.reg(12, 's')).amount = 6000, '3: on-spot surcharge on the event date (solo)');
-- never below zero
update public.event_pricing_windows set adjustment = -100000 where event_id = pg_temp.ev('s');
select pg_temp.check((select list_price = 0 from public.event_offer_price(null, pg_temp.ev('s'), 1)), '3: a discount never takes the price below ₹0');

-- ── 4. public read helpers ─────────────────────────────────────────────────
set role anon;
select pg_temp.check((select count(*) = 2 from public.active_price_windows(array[pg_temp.ev('t'), pg_temp.ev('s')])), '4: active windows readable signed out');
select pg_temp.check((select count(*) >= 3 from public.event_pricing_windows), '4: window settings publicly readable');
select pg_temp.expect_error($q$select public.admin_set_event_price_windows(pg_temp.ev('s'), '[]')$q$, 'permission denied');
reset role;

-- ── 5. re-run is safe ──────────────────────────────────────────────────────
create temp table before_rerun as select string_agg(coalesce(code, '-'), ',' order by id) c from public.teams;
\ir ../migrations/0032_team_codes_price_windows.sql
select pg_temp.check((select c from before_rerun) = (select string_agg(coalesce(code, '-'), ',' order by id) from public.teams)
  and (select count(*) = 4 from public.event_pricing_windows), '5: re-run keeps codes and windows');
select 'ALL 0032 TESTS PASSED';
