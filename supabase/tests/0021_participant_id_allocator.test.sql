-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0021_participant_id_allocator: backfill, lowest-released reuse, E/GR
-- independence, idempotent approval, append-only history, access control,
-- duplicate prevention, malformed input, re-runnability.
\set ON_ERROR_STOP 1

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
create or replace function pg_temp.pid(p_n int) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.id_of(p_n int) returns text language sql as
$$ select participant_id from public.profiles where id = pg_temp.pid(p_n) $$;

-- ── 1. Backfill a live-like state (gap at 0007, rejected holder, null id) ──
-- Rebuild the pre-0021 world: drop the allocator state, plant legacy ids.
alter table public.profiles disable trigger trg_guard_profile_participant_id;
insert into auth.users (id, email)
  select pg_temp.pid(n), 'u' || n || '@x.test' from generate_series(1, 9) n;
update public.profiles set approval_status = 'approved', participant_id = 'W27/E/' || lpad(right(id::text, 2)::int::text, 4, '0')
  where id in (select pg_temp.pid(n) from generate_series(1, 9) n where n not in (5, 7));
update public.profiles set approval_status = 'rejected', participant_id = 'W27/E/0005' where id = pg_temp.pid(5);
update public.profiles set approval_status = 'rejected', participant_id = null where id = pg_temp.pid(7);
update public.profiles set role = 'admin', admin_scopes = array['signups'] where id = pg_temp.pid(1);
alter table public.profiles enable trigger trg_guard_profile_participant_id;
select setval('public.participant_seq', 9, true);
\ir ../migrations/0021_participant_id_allocator.sql

select pg_temp.check((select count(*) = 8 from public.participant_id_allocations), '1: 8 existing ids backfilled');
select pg_temp.check(not exists (select 1 from public.profiles p left join public.participant_id_allocations a on a.profile_id = p.id
                                 where p.participant_id is distinct from a.participant_id), '1: every profile matches its allocation');
select pg_temp.check((select string_agg(participant_id, ',' order by participant_id) from public.profiles)
  = 'W27/E/0001,W27/E/0002,W27/E/0003,W27/E/0004,W27/E/0005,W27/E/0006,W27/E/0008,W27/E/0009', '1: ids preserved exactly (no renumbering)');
select pg_temp.check(pg_temp.id_of(5) = 'W27/E/0005', '1: rejected profile keeps its id');
select pg_temp.check((select count(*) = 8 and bool_and(action = 'backfilled') from public.participant_id_history), '1: one backfilled history row per id');
select pg_temp.check((select next_number from public.participant_id_namespaces where namespace = 'E') = 10, '1: next fresh E is 0010');
select pg_temp.check((select next_number from public.participant_id_namespaces where namespace = 'GR') = 1, '1: GR starts at 0001');
select pg_temp.check(not exists (select 1 from public.participant_id_released), '1: gap 0007 not inferred as released');

-- re-run is a no-op
create temp table snap as
  select (select json_agg(al order by namespace, number)::text from public.participant_id_allocations al) a_json,
         (select count(*) from public.participant_id_history) h_count,
         (select json_agg(n order by namespace)::text from (select namespace, next_number from public.participant_id_namespaces) n) n_json;
\ir ../migrations/0021_participant_id_allocator.sql
select pg_temp.check((select s.a_json = (select json_agg(al order by namespace, number)::text from public.participant_id_allocations al)
   and s.h_count = (select count(*) from public.participant_id_history)
   and s.n_json = (select json_agg(n order by namespace)::text from (select namespace, next_number from public.participant_id_namespaces) n)
   from snap s), '1: re-running 0021 changes nothing');

-- ── 2. Approval uses the allocator, idempotently ───────────────────────────
insert into auth.users (id, email) values (pg_temp.pid(20), 'n20@x.test'), (pg_temp.pid(21), 'n21@x.test'), (pg_temp.pid(22), 'n22@x.test');
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.pid(1)::text, false);
select public.admin_set_approval(pg_temp.pid(20), 'approved');
reset role;
select pg_temp.check(pg_temp.id_of(20) = 'W27/E/0010', '2: first new approval gets W27/E/0010');
set role authenticated;
select public.admin_set_approval(pg_temp.pid(20), 'approved');
select public.admin_set_approval(pg_temp.pid(20), 'rejected');
reset role;
select pg_temp.check(pg_temp.id_of(20) = 'W27/E/0010' and (select count(*) from public.participant_id_history where profile_id = pg_temp.pid(20)) = 1,
  '2: re-approval and rejection keep the id (no new allocation, no release)');
set role authenticated;
select public.admin_set_approval(pg_temp.pid(20), 'approved');
select public.admin_set_approval(pg_temp.pid(7), 'approved');
reset role;
select pg_temp.check(pg_temp.id_of(20) = 'W27/E/0010' and pg_temp.id_of(7) = 'W27/E/0011', '2: previously id-less rejected profile gets the next fresh number, not gap 0007');
select pg_temp.check((select actor = pg_temp.pid(1) and reason = 'approval' and action = 'assigned' from public.participant_id_history
   where profile_id = pg_temp.pid(7)), '2: history records actor and reason');

-- non-signups admin / participant cannot approve
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.pid(2)::text, false);
select pg_temp.expect_error($q$select public.admin_set_approval('00000000-0000-0000-0000-000000000021', 'approved')$q$, 'FORBIDDEN');
select set_config('request.jwt.claim.sub', pg_temp.pid(1)::text, false);
select pg_temp.expect_error($q$select public.admin_set_approval('00000000-0000-0000-0000-000000000099', 'approved')$q$, 'USER_NOT_FOUND');
select pg_temp.expect_error($q$select public.admin_set_approval(null, 'approved')$q$, 'INVALID_REQUEST');
reset role;

-- ── 3. Release + lowest-number reuse; E/GR independence ────────────────────
select public.participant_id_release(pg_temp.pid(9), 'E', null, 'test');
select public.participant_id_release(pg_temp.pid(3), 'E', null, 'test');
select pg_temp.check(pg_temp.id_of(9) is null and pg_temp.id_of(3) is null, '3: release clears the profile id');
select pg_temp.check((select array_agg(number order by number) from public.participant_id_released where namespace = 'E') = array[3, 9], '3: released numbers enter the pool');
select pg_temp.check(public.participant_id_allocate(pg_temp.pid(9), 'GR', null, 'test') = 'W27/GR/0001', '3: GR allocates independently from 0001');
select pg_temp.check(public.participant_id_allocate(pg_temp.pid(3), 'GR', null, 'test') = 'W27/GR/0002', '3: GR counter advances');
select pg_temp.check((select array_agg(number order by number) from public.participant_id_released where namespace = 'E') = array[3, 9], '3: GR allocation does not consume E releases');
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.pid(1)::text, false);
select public.admin_set_approval(pg_temp.pid(21), 'approved');
select public.admin_set_approval(pg_temp.pid(22), 'approved');
reset role;
select pg_temp.check(pg_temp.id_of(21) = 'W27/E/0003', '3: lowest released number (0003) reused first');
select pg_temp.check(pg_temp.id_of(22) = 'W27/E/0009', '3: then the next released number (0009)');
insert into auth.users (id, email) values (pg_temp.pid(23), 'n23@x.test');
select pg_temp.check(public.participant_id_allocate(pg_temp.pid(23), 'E') = 'W27/E/0012', '3: pool empty -> fresh counter resumes at 0012');
select pg_temp.check((select next_number from public.participant_id_namespaces where namespace = 'E') = 13
                 and (select next_number from public.participant_id_namespaces where namespace = 'GR') = 3, '3: counters E=13, GR=3');
select pg_temp.check((select string_agg(action, ',' order by id) from public.participant_id_history where participant_id = 'W27/E/0003')
  = 'backfilled,released,assigned', '3: history shows backfilled -> released -> reassigned for 0003');
select pg_temp.check((select bool_and(p.participant_id = a.participant_id) and count(*) = (select count(*) from public.profiles where participant_id is not null)
   from public.participant_id_allocations a join public.profiles p on p.id = a.profile_id), '3: allocations and profiles still consistent');

-- ── 4. Duplicate prevention and malformed input ────────────────────────────
select pg_temp.check(public.participant_id_allocate(pg_temp.pid(23), 'E') = 'W27/E/0012', '4: allocate is idempotent for the same namespace');
select pg_temp.expect_error($q$select public.participant_id_allocate('00000000-0000-0000-0000-000000000023', 'GR')$q$, 'PARTICIPANT_ID_ALREADY_ASSIGNED');
select pg_temp.expect_error($q$select public.participant_id_allocate('00000000-0000-0000-0000-000000000023', 'X')$q$, 'INVALID_PARTICIPANT_ID_NAMESPACE');
select pg_temp.expect_error($q$select public.participant_id_allocate('00000000-0000-0000-0000-000000000023', null)$q$, 'INVALID_PARTICIPANT_ID_NAMESPACE');
select pg_temp.expect_error($q$select public.participant_id_allocate(null, 'E')$q$, 'PROFILE_REQUIRED');
select pg_temp.expect_error($q$select public.participant_id_allocate('00000000-0000-0000-0000-000000000099', 'E')$q$, 'PROFILE_NOT_FOUND');
select pg_temp.expect_error($q$select public.participant_id_release('00000000-0000-0000-0000-000000000023', 'GR')$q$, 'PARTICIPANT_ID_NOT_ASSIGNED');
select pg_temp.expect_error($q$select public.participant_id_release('00000000-0000-0000-0000-000000000023', 'bogus')$q$, 'INVALID_PARTICIPANT_ID_NAMESPACE');
select pg_temp.expect_error($q$insert into public.participant_id_allocations (namespace, number, participant_id, profile_id) values ('E', 12, 'W27/E/0012', null)$q$, 'participant_id_allocations_pkey');
select pg_temp.expect_error($q$insert into public.participant_id_allocations (namespace, number, participant_id, profile_id) values ('E', 50, 'W27/E/0050', '00000000-0000-0000-0000-000000000023')$q$, 'participant_id_allocations_profile_id_key');
select pg_temp.expect_error($q$insert into public.participant_id_allocations (namespace, number, participant_id) values ('E', 51, 'W27/E/51')$q$, 'participant_id_allocations_format');
select pg_temp.expect_error($q$insert into public.participant_id_allocations (namespace, number, participant_id) values ('E', 10000, 'W27/E/10000')$q$, 'violates check constraint');
-- the profile column can only mirror the allocator, even for the table owner
select pg_temp.expect_error($q$update public.profiles set participant_id = 'W27/E/0777' where id = '00000000-0000-0000-0000-000000000023'$q$, 'PARTICIPANT_ID_MANAGED_BY_ALLOCATOR');
select pg_temp.expect_error($q$update public.profiles set participant_id = null where id = '00000000-0000-0000-0000-000000000023'$q$, 'PARTICIPANT_ID_MANAGED_BY_ALLOCATOR');
select pg_temp.expect_error($q$update public.profiles set participant_id = 'W27/E/0001' where id = '00000000-0000-0000-0000-000000000023'$q$, 'PARTICIPANT_ID_MANAGED_BY_ALLOCATOR');
-- exhaustion
update public.participant_id_namespaces set next_number = 10000 where namespace = 'GR';
insert into auth.users (id, email) values (pg_temp.pid(24), 'n24@x.test');
select pg_temp.expect_error($q$select public.participant_id_allocate('00000000-0000-0000-0000-000000000024', 'GR')$q$, 'PARTICIPANT_ID_SPACE_EXHAUSTED');
update public.participant_id_namespaces set next_number = 3 where namespace = 'GR';

-- ── 5. History is append-only ───────────────────────────────────────────────
select pg_temp.expect_error($q$update public.participant_id_history set reason = 'x'$q$, 'PARTICIPANT_ID_HISTORY_APPEND_ONLY');
select pg_temp.expect_error($q$delete from public.participant_id_history$q$, 'PARTICIPANT_ID_HISTORY_APPEND_ONLY');
select pg_temp.expect_error($q$truncate public.participant_id_history$q$, 'PARTICIPANT_ID_HISTORY_APPEND_ONLY');

-- ── 6. Unauthorized access (Supabase grants everything by default; the
--       migration's revokes must win, so grant first and re-run 0021) ──────
grant all on all tables in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
\ir ../migrations/0021_participant_id_allocator.sql
select pg_temp.check(not has_function_privilege('authenticated', 'public.participant_id_allocate(uuid,text,uuid,text)', 'execute')
                 and not has_function_privilege('anon', 'public.participant_id_allocate(uuid,text,uuid,text)', 'execute')
                 and not has_function_privilege('authenticated', 'public.participant_id_release(uuid,text,uuid,text)', 'execute')
                 and not has_function_privilege('anon', 'public.participant_id_release(uuid,text,uuid,text)', 'execute')
                 and has_function_privilege('service_role', 'public.participant_id_allocate(uuid,text,uuid,text)', 'execute'),
  '6: allocate/release executable by service_role only');
select pg_temp.check(not has_table_privilege('authenticated', 'public.participant_id_history', 'insert')
                 and not has_table_privilege('authenticated', 'public.participant_id_allocations', 'update')
                 and not has_table_privilege('anon', 'public.participant_id_allocations', 'select')
                 and not has_sequence_privilege('authenticated', 'public.participant_seq', 'usage'),
  '6: no client writes, no anon reads, retired sequence unusable');
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.pid(23)::text, false);
select pg_temp.expect_error($q$select public.participant_id_allocate('00000000-0000-0000-0000-000000000024', 'E')$q$, 'permission denied');
select pg_temp.expect_error($q$select public.participant_id_release('00000000-0000-0000-0000-000000000023', 'E')$q$, 'permission denied');
select pg_temp.expect_error($q$insert into public.participant_id_released (namespace, number) values ('E', 1)$q$, 'permission denied');
select pg_temp.expect_error($q$select nextval('public.participant_seq')$q$, 'permission denied');
select pg_temp.check((select count(*) from public.participant_id_allocations) = 0
                 and (select count(*) from public.participant_id_history) = 0, '6: participants see no allocation/history rows');
-- a participant cannot rewrite their own id through their profile-update policy
select pg_temp.expect_error($q$update public.profiles set participant_id = 'W27/E/0001' where id = '00000000-0000-0000-0000-000000000023'$q$, 'PARTICIPANT_ID_MANAGED_BY_ALLOCATOR');
select set_config('request.jwt.claim.sub', pg_temp.pid(1)::text, false);
select pg_temp.check((select count(*) from public.participant_id_history) > 0
                 and (select count(*) from public.participant_id_allocations) > 0, '6: signups admin can read allocations/history');
reset role;
set role anon;
select pg_temp.expect_error($q$select count(*) from public.participant_id_history$q$, 'permission denied');
reset role;

-- ── 7. Account deletion does not release ───────────────────────────────────
delete from auth.users where id = pg_temp.pid(23);
select pg_temp.check((select profile_id is null from public.participant_id_allocations where participant_id = 'W27/E/0012')
                 and not exists (select 1 from public.participant_id_released where number = 12), '7: deleted account keeps number 0012 consumed');
select pg_temp.check((select count(*) from public.participant_id_history where participant_id = 'W27/E/0012') = 1, '7: history survives account deletion');
select pg_temp.check(public.participant_id_allocate(pg_temp.pid(24), 'E') = 'W27/E/0013', '7: next allocation skips the deleted owner''s number');

select 'ALL 0021 TESTS PASSED';
