-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0016_event_archive: archive/restore, history-safe delete, archived visibility and registration guards.
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
  return 'PASS ' || p_needle;
end $$;
create or replace function pg_temp.check(p_ok boolean, p_label text) returns text
language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_label; end if;
  return 'PASS ' || p_label;
end $$;

-- users
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','admin@x.test','{"full_name":"Admin"}'),
 ('00000000-0000-0000-0000-00000000000b','u@x.test','{"full_name":"U"}'),
 ('00000000-0000-0000-0000-00000000000c','v@x.test','{"full_name":"V"}'),
 ('00000000-0000-0000-0000-00000000000d','w@x.test','{"full_name":"W"}');
update public.profiles set role='admin', admin_scopes=array['events','payments'], approval_status='approved'
 where id='00000000-0000-0000-0000-00000000000a';
update public.profiles set approval_status='approved' where id <> '00000000-0000-0000-0000-00000000000a';

-- events: R(root) -> C1 (used), C2 (unused); S standalone unused; T -> T1 unused; TE team event under R
insert into public.events (id, slug, title, registration_fee, registration_open, is_live, parent_event_id, team_enabled, team_max) values
 ('10000000-0000-0000-0000-000000000001','r','R',0,true,true,null,false,4),
 ('10000000-0000-0000-0000-000000000002','c1','C1',10000,true,true,'10000000-0000-0000-0000-000000000001',false,4),
 ('10000000-0000-0000-0000-000000000003','c2','C2',10000,true,true,'10000000-0000-0000-0000-000000000001',false,4),
 ('10000000-0000-0000-0000-000000000004','s','S',0,true,true,null,false,4),
 ('10000000-0000-0000-0000-000000000005','t','T',0,true,true,null,false,4),
 ('10000000-0000-0000-0000-000000000006','t1','T1',0,true,true,'10000000-0000-0000-0000-000000000005',false,4),
 ('10000000-0000-0000-0000-000000000007','te','TE',5000,true,true,'10000000-0000-0000-0000-000000000001',true,4);

-- U registers for C1 (history)
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
select (public.register_for_event('10000000-0000-0000-0000-000000000002')).id is not null as u_registered_c1;
select pg_temp.expect_error($q$select public.admin_delete_event('10000000-0000-0000-0000-000000000004')$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$select public.admin_set_event_archived('10000000-0000-0000-0000-000000000004', true)$q$, 'FORBIDDEN');

-- Admin: delete attempts
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select pg_temp.expect_error($q$select public.admin_delete_event('10000000-0000-0000-0000-000000000002')$q$, 'EVENT_HAS_HISTORY');
select pg_temp.expect_error($q$select public.admin_delete_event('10000000-0000-0000-0000-000000000001')$q$, 'EVENT_HAS_HISTORY');
-- direct table delete (RLS permits events admins) must still be blocked by FK RESTRICT
select pg_temp.expect_error($q$delete from public.events where id='10000000-0000-0000-0000-000000000001'$q$, 'violates foreign key constraint');
select pg_temp.expect_error($q$delete from public.events where id='10000000-0000-0000-0000-000000000002'$q$, 'violates foreign key constraint');
select pg_temp.check((select count(*) from public.registrations) = 1, 'registration history intact after delete attempts');
select public.admin_delete_event('10000000-0000-0000-0000-000000000004');
select pg_temp.check(not exists(select 1 from public.events where id='10000000-0000-0000-0000-000000000004'), 'unused standalone deleted');
select public.admin_delete_event('10000000-0000-0000-0000-000000000005');
select pg_temp.check(not exists(select 1 from public.events where slug in ('t','t1')), 'unused parent + unused child deleted');

-- Archive R subtree; separately archive C2 first to test precise restore
select public.admin_set_event_archived('10000000-0000-0000-0000-000000000003', true);
select pg_sleep(0.01);
select public.admin_set_event_archived('10000000-0000-0000-0000-000000000001', true);
select pg_temp.check((select count(*) from public.events where archived_at is not null) = 4, 'R, C1, C2, TE archived');
select pg_temp.check((select bool_and(not registration_open and not featured) from public.events where slug in ('r','c1','te')), 'archive closes registration/unfeatures');
select pg_temp.check((select archived_by from public.events where slug='c1') = '00000000-0000-0000-0000-00000000000a', 'archived_by recorded');
select pg_temp.check((select count(*) from public.events) = 4, 'admin still sees archived events');
-- admin can still review payment on archived-event history
select (public.admin_set_payment_status((select id from public.registrations limit 1), 'rejected', 'test')).payment_status = 'rejected' as admin_payment_update_ok_on_archived;
select pg_temp.expect_error($q$insert into public.events (slug,title,parent_event_id) values ('n','N','10000000-0000-0000-0000-000000000001')$q$, 'PARENT_ARCHIVED');

-- Even if an admin re-opens registration on archived events, the DB guard blocks it
update public.events set registration_open = true where archived_at is not null;
-- V: cannot register on archived; cannot see archived
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
select pg_temp.expect_error($q$select public.register_for_event('10000000-0000-0000-0000-000000000003')$q$, 'EVENT_ARCHIVED');
select pg_temp.expect_error($q$select public.register_team('10000000-0000-0000-0000-000000000007', array['00000000-0000-0000-0000-00000000000d']::uuid[])$q$, 'EVENT_ARCHIVED');
select pg_temp.check((select count(*) from public.events) = 0, 'unrelated participant sees no archived events');
select pg_temp.check((select count(*) from public.teams) = 0 and (select count(*) from public.registrations) = 0, 'no rows leaked from failed team registration');

-- U: sees own history (R ancestor + C1), not unrelated C2/TE; cannot re-activate via cancel+register
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
select pg_temp.check((select string_agg(slug, ',' order by slug) from public.events) = 'c1,r', 'registrant sees own archived history only');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
update public.registrations set registration_status = 'cancelled';
select pg_temp.check((select count(*) from public.registrations where registration_status='cancelled') = 1, 'status update on archived history allowed');
select pg_temp.expect_error($q$update public.registrations set registration_status = 'pending'$q$, 'EVENT_ARCHIVED');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
select pg_temp.expect_error($q$select public.register_for_event('10000000-0000-0000-0000-000000000002')$q$, 'EVENT_ARCHIVED');

-- anon
reset role; set role anon;
select set_config('request.jwt.claim.sub','',false);
select pg_temp.check((select count(*) from public.events) = 0, 'anon sees no archived events');

-- Restore
reset role; set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
update public.events set registration_open = false;
select pg_temp.expect_error($q$select public.admin_set_event_archived('10000000-0000-0000-0000-000000000002', false)$q$, 'PARENT_ARCHIVED');
select public.admin_set_event_archived('10000000-0000-0000-0000-000000000001', false);
select pg_temp.check((select string_agg(slug, ',' order by slug) from public.events where archived_at is null) = 'c1,r,te', 'restore brings back co-archived subtree only');
select pg_temp.check((select archived_at is not null from public.events where slug='c2'), 'separately archived C2 stays archived');
select pg_temp.check((select not registration_open from public.events where slug='c1'), 'restore keeps registration closed');
update public.events set registration_open = true where slug = 'c1';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
select (public.register_for_event('10000000-0000-0000-0000-000000000002')).id is not null as v_registers_after_restore;
select pg_temp.check((select count(*) from public.events) = 3, 'participant sees restored events, not archived C2');
reset role;
select 'ALL TESTS PASSED' as result;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select pg_temp.check((select array_agg(x order by x)::text from public.admin_event_ids_with_history() x) = '{10000000-0000-0000-0000-000000000002}', 'history ids = {C1} only');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
select pg_temp.expect_error($q$select * from public.admin_event_ids_with_history()$q$, 'FORBIDDEN');
reset role;
select 'HISTORY RPC TESTS PASSED';
