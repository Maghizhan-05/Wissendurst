-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0024_staff_participant_ids: staff backfill, every role transition through
-- super_set_admin, lowest-first reuse in E/GR/ADMIN/SUPADMIN, no-ops,
-- exhausted ranges, rollback at every step, privileges, format guards.
\set ON_ERROR_STOP 1
grant all on all tables in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated;
\ir ../migrations/0021_participant_id_allocator.sql
drop function if exists public.set_my_profile_photo(text);  -- 0026 changed its signature
\ir ../migrations/0022_profile_update_lockdown.sql
\ir ../migrations/0023_general_registration.sql
\ir ../migrations/0024_staff_participant_ids.sql
\ir ../migrations/0026_review_hardening.sql
\ir ../migrations/0030_team_pricing_roster_social.sql
update public.payment_destination_settings set default_event_upi_id = 'site.default@okbank';

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
  select ('00000000-0000-0000-0000-0000000010' || lpad(p_n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.as_user(p_n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, false) $$;
create or replace function pg_temp.pid_of(p_n int) returns text language sql stable security definer as $$
  select participant_id from public.profiles where id = pg_temp.u(p_n) $$;
create or replace function pg_temp.role_of(p_n int) returns text language sql stable security definer as $$
  select role || case when is_super_admin then '+super' else '' end from public.profiles where id = pg_temp.u(p_n) $$;
create or replace function pg_temp.pool(p_ns text) returns int[] language sql stable security definer as $$
  select coalesce(array_agg(number order by number), '{}') from public.participant_id_released where namespace = p_ns $$;
create or replace function pg_temp.hist(p_n int) returns bigint language sql stable security definer as $$
  select count(*) from public.participant_id_history where profile_id = pg_temp.u(p_n) $$;
create or replace function pg_temp.fp() returns text language sql stable security definer as $$
  select md5(concat_ws('|',
    (select json_agg(a order by namespace, number)::text from public.participant_id_allocations a),
    (select json_agg(r order by namespace, number)::text from public.participant_id_released r),
    (select count(*) from public.participant_id_history),
    (select string_agg(namespace || next_number, ',' order by namespace) from public.participant_id_namespaces),
    (select string_agg(id || coalesce(participant_id, '-') || role || is_super_admin || array_to_string(admin_scopes, ','), ',' order by id) from public.profiles))) $$;
create or replace function pg_temp.consistent() returns boolean language sql stable security definer as $$
  select not exists (select 1 from public.profiles p left join public.participant_id_allocations a on a.profile_id = p.id
                     where p.participant_id is distinct from a.participant_id) $$;
-- super_set_admin as user n
create or replace function pg_temp.set_role_as(p_actor int, p_target int, p_role user_role, p_super boolean, p_scopes text[] default array['signups','events','payments','content'])
returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.u(p_actor)::text, true);
  set local role authenticated;
  perform public.super_set_admin(pg_temp.u(p_target), p_role, p_super, p_scopes);
  reset role;
  return pg_temp.pid_of(p_target);
end $$;

-- ── 1. backfill of a live-like pre-0024 world ──────────────────────────────
-- 1..9 approved participants with E0001..E0009; then 1 & 4 made super admins
-- and 2 & 5 ordinary admins directly (as before 0024). Creation order: 4, 1
-- (supers), then 2 and 5 at the same instant (UUID tie-break: 2 < 5).
insert into auth.users (id, email) select pg_temp.u(n), 'h' || n || '@x.test' from generate_series(1, 30) n;
update public.profiles set approval_status = 'approved' where id in (select pg_temp.u(n) from generate_series(1, 9) n);
select public.participant_id_allocate(pg_temp.u(n), 'E') from generate_series(1, 9) n;
alter table public.profiles disable trigger trg_guard_profile_direct_write;
update public.profiles set created_at = '2026-01-01' where id = pg_temp.u(4);
update public.profiles set created_at = '2026-01-02' where id = pg_temp.u(1);
update public.profiles set created_at = '2026-01-03' where id in (pg_temp.u(5), pg_temp.u(2));
alter table public.profiles enable trigger trg_guard_profile_direct_write;
update public.profiles set role = 'admin', is_super_admin = true, admin_scopes = array['signups','events','payments','content']
  where id in (pg_temp.u(1), pg_temp.u(4));
update public.profiles set role = 'admin', admin_scopes = array['events'] where id in (pg_temp.u(2), pg_temp.u(5));
insert into public.events (slug, title, registration_fee, registration_open, is_live) values ('ev', 'Ev', 1000, true, true);
insert into public.registrations (profile_id, event_id, amount, registration_status, payment_status)
values (pg_temp.u(1), (select id from public.events where slug = 'ev'), 1000, 'confirmed', 'verified');
\ir ../migrations/0024_staff_participant_ids.sql

select pg_temp.check(pg_temp.pid_of(4) = 'supadmin/01' and pg_temp.pid_of(1) = 'supadmin/02', '1: supers backfilled by creation order (supadmin/01, /02)');
select pg_temp.check(pg_temp.pid_of(2) = 'admin/01' and pg_temp.pid_of(5) = 'admin/02', '1: admins backfilled by creation order then UUID (admin/01, /02)');
select pg_temp.check(pg_temp.pool('E') = array[1, 2, 4, 5], '1: staff E numbers released for reuse (0001, 0002, 0004, 0005)');
select pg_temp.check(pg_temp.pid_of(3) = 'W27/E/0003' and pg_temp.pid_of(9) = 'W27/E/0009', '1: participants keep their ids');
select pg_temp.check((select count(*) = 1 from public.registrations where profile_id = pg_temp.u(1)), '1: staff registrations preserved (UUID-owned)');
select pg_temp.check((select string_agg(action || ':' || participant_id, ',' order by id) from public.participant_id_history where profile_id = pg_temp.u(1))
  = 'assigned:W27/E/0001,released:W27/E/0001,assigned:supadmin/02', '1: history shows release + staff assignment');
select pg_temp.check(pg_temp.consistent(), '1: profiles match allocations');
create temp table snap1 as select pg_temp.fp() f;
\ir ../migrations/0024_staff_participant_ids.sql
select pg_temp.check((select f = pg_temp.fp() from snap1), '1: re-running 0024 changes nothing');
-- released E numbers go to the next approvals, lowest first
update public.profiles set role = 'admin', admin_scopes = array['signups'] where id = pg_temp.u(5);
set role authenticated;
select pg_temp.as_user(5);
select public.admin_set_approval(pg_temp.u(10), 'approved');
select public.admin_set_approval(pg_temp.u(11), 'approved');
reset role;
select pg_temp.check(pg_temp.pid_of(10) = 'W27/E/0001' and pg_temp.pid_of(11) = 'W27/E/0002', '1: next approvals reuse W27/E/0001 then 0002');
select pg_temp.check(pg_temp.pool('E') = array[4, 5], '1: E pool now 0004, 0005');

-- ── 2. role transitions through super_set_admin ────────────────────────────
begin;
select pg_temp.set_role_as(4, 3, 'admin', false, array['events']);                        -- E -> admin
commit;
select pg_temp.check(pg_temp.pid_of(3) = 'admin/03' and pg_temp.role_of(3) = 'admin', '2: E -> admin gets admin/03');
select pg_temp.check(pg_temp.pool('E') = array[3, 4, 5], '2: its W27/E/0003 joins the E pool');
-- a verified General Registration participant (user 6 -> W27/GR/0001)
update public.general_registration_settings set enabled = true, fee = 1000, upi_id = 'gr@okbank', payee_name = 'GR';
set role authenticated;
select pg_temp.as_user(6);
select public.start_general_registration();
select public.submit_general_registration_payment('UTR810006', null);
select pg_temp.as_user(4);
select public.admin_review_general_registration((select id from public.general_registrations where profile_id = pg_temp.u(6)), 'verified');
reset role;
select pg_temp.check(pg_temp.pid_of(6) = 'W27/GR/0001', '2: user 6 is W27/GR/0001 after GR verification');
begin;
select pg_temp.set_role_as(4, 6, 'admin', false);                                          -- GR -> admin
commit;
select pg_temp.check(pg_temp.pid_of(6) = 'admin/04' and pg_temp.pool('GR') = array[1], '2: GR -> admin gets admin/04, GR0001 released');
begin;
select pg_temp.set_role_as(4, 2, 'admin', true);                                           -- admin -> super
commit;
select pg_temp.check(pg_temp.pid_of(2) = 'supadmin/03' and pg_temp.role_of(2) = 'admin+super' and pg_temp.pool('ADMIN') = array[1],
  '2: admin -> super gets supadmin/03, admin/01 released');
begin;
select pg_temp.set_role_as(4, 1, 'admin', false);                                          -- super -> admin
commit;
select pg_temp.check(pg_temp.pid_of(1) = 'admin/01' and pg_temp.role_of(1) = 'admin' and pg_temp.pool('ADMIN') = '{}' and pg_temp.pool('SUPADMIN') = array[2],
  '2: super -> admin reuses lowest admin/01, supadmin/02 released');
begin;
select pg_temp.set_role_as(4, 7, 'admin', true);                                           -- E -> super reuses supadmin/02
commit;
select pg_temp.check(pg_temp.pid_of(7) = 'supadmin/02' and pg_temp.pool('SUPADMIN') = '{}', '2: lowest released supadmin/02 reused');
begin;
select pg_temp.set_role_as(4, 3, 'user', false);                                           -- admin -> user (no GR) -> E
commit;
select pg_temp.check(pg_temp.pid_of(3) = 'W27/E/0003' and pg_temp.role_of(3) = 'user' and (select admin_scopes = '{}' from public.profiles where id = pg_temp.u(3)),
  '2: demotion without GR gets the lowest released E (W27/E/0003), scopes cleared');
begin;
select pg_temp.set_role_as(4, 6, 'user', false);                                           -- admin -> user (GR) -> GR
commit;
select pg_temp.check(pg_temp.pid_of(6) = 'W27/GR/0001' and pg_temp.pool('GR') = '{}', '2: demotion with verified GR gets W27/GR/0001 back');
select pg_temp.check(pg_temp.pool('ADMIN') = array[3, 4], '2: demoted staff numbers admin/03, /04 are reusable');
-- unapproved profile promoted, then demoted
begin;
select pg_temp.set_role_as(4, 20, 'admin', false);
commit;
select pg_temp.check(pg_temp.pid_of(20) = 'admin/03', '2: unapproved profile promoted gets the lowest admin/03');
begin;
select pg_temp.set_role_as(4, 20, 'user', false);
commit;
select pg_temp.check(pg_temp.pid_of(20) is null and pg_temp.pool('ADMIN') = array[3, 4], '2: demoted unapproved profile holds no id (minted on approval)');

-- ── 3. no-ops and authorization ────────────────────────────────────────────
create temp table h7 as select pg_temp.hist(7) n, pg_temp.fp() f;
begin;
select pg_temp.set_role_as(4, 7, 'admin', true);
commit;
select pg_temp.check((select n = pg_temp.hist(7) and f = pg_temp.fp() from h7), '3: repeated identical update keeps id, no history');
create temp table h1 as select pg_temp.hist(1) n;
begin;
select pg_temp.set_role_as(4, 1, 'admin', false, array['payments']);
commit;
select pg_temp.check(pg_temp.pid_of(1) = 'admin/01' and (select admin_scopes = array['payments'] from public.profiles where id = pg_temp.u(1))
  and (select n = pg_temp.hist(1) from h1), '3: scope-only change keeps admin/01 with no new history');
set role authenticated;
select pg_temp.as_user(4);
select pg_temp.expect_error($q$select public.super_set_admin(auth.uid(), 'admin', false, array['events'])$q$, 'CANNOT_DEMOTE_SELF');
select pg_temp.expect_error($q$select public.super_set_admin(auth.uid(), 'user', true, null)$q$, 'CANNOT_DEMOTE_SELF');
select pg_temp.expect_error($q$select public.super_set_admin(gen_random_uuid(), 'admin', false, null)$q$, 'USER_NOT_FOUND');
select pg_temp.as_user(1);   -- ordinary admin
select pg_temp.expect_error($q$select public.super_set_admin('00000000-0000-0000-0000-000000001008', 'admin', true, null)$q$, 'FORBIDDEN');
select pg_temp.as_user(8);   -- participant
select pg_temp.expect_error($q$select public.super_set_admin(auth.uid(), 'admin', true, null)$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$select public.participant_id_sync_role(auth.uid())$q$, 'permission denied');
select pg_temp.expect_error($q$select public.participant_id_allocate(auth.uid(), 'SUPADMIN')$q$, 'permission denied');
select pg_temp.expect_error($q$select public.participant_id_release(auth.uid(), 'E')$q$, 'permission denied');
select pg_temp.as_user(1);
select pg_temp.expect_error($q$select public.participant_id_sync_role(auth.uid())$q$, 'permission denied');
reset role;
select pg_temp.check(pg_temp.role_of(8) = 'user' and pg_temp.pid_of(8) = 'W27/E/0008', '3: rejected callers changed nothing');
select pg_temp.check(not has_function_privilege('authenticated', 'public.participant_id_sync_role(uuid,uuid,text)', 'execute')
                 and not has_function_privilege('anon', 'public.participant_id_sync_role(uuid,uuid,text)', 'execute')
                 and has_function_privilege('service_role', 'public.participant_id_sync_role(uuid,uuid,text)', 'execute'),
  '3: sync_role is server-only');
-- GR conversion still requires an E id: a staff member cannot take GR
select pg_temp.expect_error($q$select public.participant_id_allocate('00000000-0000-0000-0000-000000001001', 'GR')$q$, 'PARTICIPANT_ID_ALREADY_ASSIGNED');

-- ── 4. exhausted staff ranges roll the role change back ────────────────────
delete from public.participant_id_released where namespace = 'ADMIN';
update public.participant_id_namespaces set next_number = 100 where namespace = 'ADMIN';
create temp table fp_ex as select pg_temp.fp() f;
select pg_temp.expect_error($q$select pg_temp.set_role_as(4, 9, 'admin', false)$q$, 'PARTICIPANT_ID_SPACE_EXHAUSTED');
select pg_temp.check((select f = pg_temp.fp() from fp_ex) and pg_temp.role_of(9) = 'user' and pg_temp.pid_of(9) = 'W27/E/0009',
  '4: ADMIN exhausted after 99 -> role + id unchanged');
update public.participant_id_namespaces set next_number = 100 where namespace = 'SUPADMIN';
select pg_temp.expect_error($q$select pg_temp.set_role_as(4, 9, 'admin', true)$q$, 'PARTICIPANT_ID_SPACE_EXHAUSTED');
select pg_temp.check(pg_temp.role_of(9) = 'user' and pg_temp.pid_of(9) = 'W27/E/0009', '4: SUPADMIN exhausted -> role + id unchanged');
-- the last admin number is still assignable
update public.participant_id_namespaces set next_number = 99 where namespace = 'ADMIN';
begin;
select pg_temp.set_role_as(4, 9, 'admin', false);
commit;
select pg_temp.check(pg_temp.pid_of(9) = 'admin/99', '4: admin/99 is the last valid number');
update public.participant_id_namespaces set next_number = 4 where namespace = 'SUPADMIN';

-- ── 5. forced failure at every step rolls everything back ─────────────────
create or replace function public.test_inject_failure() returns trigger language plpgsql as $$
begin raise exception 'INJECTED_FAILURE_%', tg_table_name; end $$;
create or replace function pg_temp.promote_with_failure(p_trigger_sql text, p_drop_sql text) returns text
language plpgsql as $$
declare v_before text := pg_temp.fp(); v_err text;
begin
  execute p_trigger_sql;
  begin
    perform pg_temp.set_role_as(4, 10, 'admin', true);
    v_err := 'NO ERROR';
  exception when others then v_err := sqlerrm;
  end;
  reset role;
  execute p_drop_sql;
  if v_err not like 'INJECTED_FAILURE%' then raise exception 'FAIL: expected injected failure, got %', v_err; end if;
  if pg_temp.fp() <> v_before then raise exception 'FAIL: partial role change persisted after %', v_err; end if;
  return 'PASS rollback after ' || v_err;
end $$;
select pg_temp.promote_with_failure(   -- role update
  'create trigger tf before update of role on public.profiles for each row when (new.role = ''admin'') execute function public.test_inject_failure()',
  'drop trigger tf on public.profiles');
select pg_temp.promote_with_failure(   -- release
  'create trigger tf before insert on public.participant_id_released for each row execute function public.test_inject_failure()',
  'drop trigger tf on public.participant_id_released');
select pg_temp.promote_with_failure(   -- allocation
  'create trigger tf before insert on public.participant_id_allocations for each row when (new.namespace = ''SUPADMIN'') execute function public.test_inject_failure()',
  'drop trigger tf on public.participant_id_allocations');
select pg_temp.promote_with_failure(   -- profile id update
  'create trigger tf before update of participant_id on public.profiles for each row when (new.participant_id like ''supadmin/%'') execute function public.test_inject_failure()',
  'drop trigger tf on public.profiles');
select pg_temp.promote_with_failure(   -- history
  'create trigger tf before insert on public.participant_id_history for each row when (new.namespace = ''SUPADMIN'') execute function public.test_inject_failure()',
  'drop trigger tf on public.participant_id_history');
drop function public.test_inject_failure();
select pg_temp.check(pg_temp.role_of(10) = 'user' and pg_temp.pid_of(10) = 'W27/E/0001', '5: user 10 untouched after all injected failures');
begin;
select pg_temp.set_role_as(4, 10, 'admin', true);
commit;
select pg_temp.check(pg_temp.pid_of(10) = 'supadmin/04', '5: clean promotion succeeds afterwards');

-- ── 6. format guards ────────────────────────────────────────────────────────
select pg_temp.expect_error($q$insert into public.participant_id_allocations (namespace, number, participant_id) values ('ADMIN', 50, 'admin/5')$q$, 'participant_id_allocations_format');
select pg_temp.expect_error($q$insert into public.participant_id_allocations (namespace, number, participant_id) values ('ADMIN', 100, 'admin/100')$q$, 'participant_id_allocations_format');
select pg_temp.expect_error($q$insert into public.participant_id_allocations (namespace, number, participant_id) values ('SUPADMIN', 50, 'admin/50')$q$, 'participant_id_allocations_format');
select pg_temp.expect_error($q$insert into public.participant_id_allocations (namespace, number, participant_id) values ('E', 50, 'W27/E/50')$q$, 'participant_id_allocations_format');
select pg_temp.expect_error($q$insert into public.participant_id_namespaces (namespace, prefix, width) values ('X', 'x/', 2)$q$, 'participant_id_namespaces_known');
select pg_temp.expect_error($q$update public.participant_id_namespaces set width = 3 where namespace = 'ADMIN'$q$, 'participant_id_namespaces_known');
select pg_temp.expect_error($q$update public.participant_id_namespaces set next_number = 101 where namespace = 'ADMIN'$q$, 'participant_id_namespaces_next_in_range');
select pg_temp.expect_error($q$insert into public.participant_id_released (namespace, number) values ('ADMIN', 100)$q$, 'participant_id_released_in_range');
select pg_temp.expect_error($q$select public.participant_id_allocate('00000000-0000-0000-0000-000000001021', 'STAFF')$q$, 'INVALID_PARTICIPANT_ID_NAMESPACE');
select pg_temp.expect_error($q$update public.participant_id_history set reason = 'x'$q$, 'PARTICIPANT_ID_HISTORY_APPEND_ONLY');

select pg_temp.check(pg_temp.consistent(), 'final: every profile matches its allocation');
select pg_temp.check(not exists (
  select 1 from public.participant_id_allocations a join public.participant_id_released r
    on r.namespace = a.namespace and r.number = a.number), 'final: no number is both allocated and released');
select pg_temp.check(not exists (
  select 1 from public.profiles p join public.participant_id_allocations a on a.profile_id = p.id
  where a.namespace <> case when p.role = 'admin' and p.is_super_admin then 'SUPADMIN' when p.role = 'admin' then 'ADMIN'
                            when public.is_general_registered(p.id) then 'GR' else 'E' end), 'final: every profile sits in its role namespace');
select 'ALL 0024 TESTS PASSED';
