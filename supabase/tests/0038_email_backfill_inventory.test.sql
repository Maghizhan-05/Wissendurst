\set ON_ERROR_STOP 1
create function pg_temp.check(ok boolean, label text) returns text language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'FAIL: %',label; end if; return 'PASS '||label; end $$;
create function pg_temp.expect_error(q text, needle text) returns text language plpgsql as $$
begin execute q; raise exception 'EXPECTED_ERROR'; exception when others then
 if sqlerrm = 'EXPECTED_ERROR' or position(needle in sqlerrm)=0 then raise exception 'WRONG_ERROR: % wanted %',sqlerrm,needle; end if;
 return 'PASS refused '||needle; end $$;
select pg_temp.check(to_regprocedure('public.email_backfill_inventory()') is not null,'inventory RPC exists');
-- Re-running under permissive defaults must repair privileges.
grant execute on function public.email_backfill_inventory() to public, anon, service_role;
\ir ../migrations/0038_email_backfill_inventory.sql
select pg_temp.check(not has_function_privilege(r,'public.email_backfill_inventory()','EXECUTE'),r||' cannot execute inventory') from unnest(array['anon','service_role']) r;
select pg_temp.check(has_function_privilege('authenticated','public.email_backfill_inventory()','EXECUTE'),'authenticated can execute guarded RPC');
select pg_temp.check(not has_table_privilege(r,'public.email_delivery_log','SELECT'),r||' audit remains private') from unnest(array['anon','authenticated','service_role']) r;
create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-00000038'||lpad(n::text,4,'0'))::uuid $$;
insert into auth.users(id,email) select pg_temp.u(n),'d38-'||n||'@example.test' from generate_series(1,15) n;
update public.profiles set approval_status='approved';
update public.profiles set role='admin',is_super_admin=true where id=pg_temp.u(1);
update public.profiles set role='admin',admin_scopes=array['payments','signups','events'] where id=pg_temp.u(2);
-- Ban before promotion also tests a formerly banned account gaining super flag.
insert into public.profile_bans(profile_id,reason) values(pg_temp.u(3),'test ban');
update public.profiles set role='admin',is_super_admin=true where id=pg_temp.u(3);
set role authenticated;
select set_config('request.jwt.claim.sub','',false);
select pg_temp.expect_error('select public.email_backfill_inventory()','AUTH_REQUIRED');
select set_config('request.jwt.claim.sub',pg_temp.u(2)::text,false);
select pg_temp.expect_error('select public.email_backfill_inventory()','FORBIDDEN');
select set_config('request.jwt.claim.sub',pg_temp.u(3)::text,false);
select pg_temp.expect_error('select public.email_backfill_inventory()','FORBIDDEN');
select set_config('request.jwt.claim.sub',pg_temp.u(4)::text,false);
select pg_temp.expect_error('select public.email_backfill_inventory()','FORBIDDEN');
select set_config('request.jwt.claim.sub',pg_temp.u(1)::text,false);
select pg_temp.check(public.email_backfill_inventory()='{"units":[],"remaining_units":0,"remaining_recipient_events":0}'::jsonb,'empty exact schema');
reset role;
insert into public.events(id,slug,title,registration_fee,registration_open,is_live) values(pg_temp.u(100),'d38','D38',0,true,true);
insert into public.teams(id,event_id,head_profile_id) values(pg_temp.u(200),pg_temp.u(100),pg_temp.u(6));
insert into public.registrations(id,profile_id,event_id,amount,registration_status,payment_status,team_id,is_team_head)
values(pg_temp.u(301),pg_temp.u(4),pg_temp.u(100),0,'confirmed','verified',null,false),
(pg_temp.u(302),pg_temp.u(5),pg_temp.u(100),0,'confirmed','verified',null,false),
(pg_temp.u(303),pg_temp.u(6),pg_temp.u(100),0,'confirmed','verified',pg_temp.u(200),true),
(pg_temp.u(304),pg_temp.u(7),pg_temp.u(100),0,'confirmed','verified',pg_temp.u(200),false),
(pg_temp.u(305),pg_temp.u(8),pg_temp.u(100),0,'confirmed','verified',pg_temp.u(200),false),
(pg_temp.u(306),pg_temp.u(9),pg_temp.u(100),0,'pending','unpaid',null,false),
(pg_temp.u(307),pg_temp.u(10),pg_temp.u(100),0,'cancelled','verified',null,false),
(pg_temp.u(308),pg_temp.u(11),pg_temp.u(100),0,'confirmed','unpaid',null,false),
(pg_temp.u(309),pg_temp.u(12),pg_temp.u(100),0,'pending','unpaid',pg_temp.u(200),false);
insert into public.email_delivery_log(kind,outcome,registration_id,source) values
('registration_confirmed','sent',pg_temp.u(302),'automatic'),
('registration_confirmed','failed',pg_temp.u(301),'automatic'),
('registration_confirmed','not_configured',pg_temp.u(301),'automatic'),
('welcome','sent',pg_temp.u(301),'automatic'),
('payment_status','sent',pg_temp.u(301),'automatic'),
('registration_confirmed','sent',pg_temp.u(399),'automatic');
create function pg_temp.inventory() returns jsonb language plpgsql as $$ begin
perform set_config('request.jwt.claim.sub',pg_temp.u(1)::text,false);
return public.email_backfill_inventory(); end $$;
set role authenticated;
select pg_temp.check(pg_temp.inventory()=jsonb_build_object('units',jsonb_build_array(
jsonb_build_object('registration_id',pg_temp.u(301),'recipient_count',1,'sent_count',0),
jsonb_build_object('registration_id',pg_temp.u(303),'recipient_count',3,'sent_count',0)),
'remaining_units',2,'remaining_recipient_events',4),'canonical solo and team head; only current confirmed verified; irrelevant evidence ignored; deterministic order');
reset role;
-- D030 logs every recipient against the calling registration, not each recipient ID.
insert into public.email_delivery_log(kind,outcome,registration_id,source) values
('registration_confirmed','sent',pg_temp.u(304),'automatic'),
('registration_confirmed','sent',pg_temp.u(304),'automatic');
set role authenticated;
select pg_temp.check(pg_temp.inventory()->'units'->1->>'sent_count'='2','COUNT rows not distinct registration IDs; member evidence rolls up to canonical head');
select pg_temp.check(pg_temp.inventory()->>'remaining_recipient_events'='4','partial team retries count full recipients, not deficit');
reset role;
insert into public.email_delivery_log(kind,outcome,registration_id,source) values('registration_confirmed','sent',pg_temp.u(303),'automatic');
set role authenticated;
select pg_temp.check(pg_temp.inventory()->>'remaining_units'='1','fully accepted team excluded');
reset role;
-- Removing an accepted member from the current recipient set removes its evidence.
update public.registrations set registration_status='cancelled' where id=pg_temp.u(304);
set role authenticated;
select pg_temp.check(pg_temp.inventory()->'units'->1=jsonb_build_object('registration_id',pg_temp.u(303),'recipient_count',2,'sent_count',1),'removed current recipient does not contribute historical evidence');
select pg_temp.check(pg_temp.inventory()->>'remaining_recipient_events'='3','recipient totals reflect current roster');
reset role;
insert into public.email_delivery_log(kind,outcome,registration_id,source) values
('registration_confirmed','sent',pg_temp.u(303),'automatic'),
('registration_confirmed','sent',pg_temp.u(303),'automatic'),
('registration_confirmed','sent',pg_temp.u(301),'automatic');
set role authenticated;
select pg_temp.check(pg_temp.inventory()='{"units":[],"remaining_units":0,"remaining_recipient_events":0}'::jsonb,'solo success and over-accepted team have no gap; no negative totals');
select pg_temp.expect_error('select * from public.email_delivery_log','permission denied');
reset role;
-- A team without a current eligible head is not an actionable canonical unit.
update public.registrations set registration_status='cancelled' where id=pg_temp.u(303);
set role authenticated;
select pg_temp.check(pg_temp.inventory()->'units'='[]'::jsonb,'ineligible team head never canonicalized to arbitrary member');
reset role;
