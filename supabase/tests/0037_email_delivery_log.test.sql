\set ON_ERROR_STOP 1
create function pg_temp.check(ok boolean, label text) returns text language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'FAIL: %',label; end if; return 'PASS '||label; end $$;
create function pg_temp.expect_error(q text, needle text) returns text language plpgsql as $$
begin execute q; raise exception 'EXPECTED_ERROR'; exception when others then
 if sqlerrm = 'EXPECTED_ERROR' or position(needle in sqlerrm)=0 then raise exception 'WRONG_ERROR: % wanted %',sqlerrm,needle; end if;
 return 'PASS refused '||needle; end $$;
select pg_temp.check(to_regclass('public.email_delivery_log') is not null, 'delivery audit exists');
select pg_temp.check(to_regclass('public.registration_email_resend_claims') is not null, 'claim audit exists');
select pg_temp.check(to_regprocedure('public.claim_registration_email_resend(uuid,uuid)') is not null, 'claim RPC exists');
select pg_temp.check(to_regprocedure('public.email_delivery_summary()') is not null, 'summary RPC exists');
-- Emulate permissive Supabase defaults BEFORE re-applying the migration.
grant all on public.email_delivery_log, public.registration_email_resend_claims to anon, authenticated, service_role;
grant execute on function public.email_delivery_summary(), public.claim_registration_email_resend(uuid,uuid) to public, anon, service_role;
\ir ../migrations/0037_email_delivery_log.sql
select pg_temp.check(not has_table_privilege(r,t,p), r||' cannot '||p||' '||t)
from unnest(array['anon','authenticated','service_role']) r
cross join unnest(array['public.email_delivery_log','public.registration_email_resend_claims']) t
cross join unnest(array['SELECT','UPDATE','DELETE','TRUNCATE']) p;
select pg_temp.check(not has_any_column_privilege(r,t,'INSERT'),r||' cannot insert '||t)
from unnest(array['anon','authenticated']) r cross join unnest(array['public.email_delivery_log','public.registration_email_resend_claims']) t;
select pg_temp.check(not has_any_column_privilege('service_role','public.registration_email_resend_claims','INSERT'),'service cannot forge claims');
select pg_temp.check(not has_column_privilege('service_role','public.email_delivery_log','created_at','INSERT'),'service cannot forge time');
select pg_temp.check(not has_function_privilege(r,f,'EXECUTE'),r||' cannot execute '||f)
from unnest(array['anon','service_role']) r cross join unnest(array['public.email_delivery_summary()','public.claim_registration_email_resend(uuid,uuid)']) f;
create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000037'||lpad(n::text,2,'0'))::uuid $$;
insert into auth.users(id,email,raw_user_meta_data) select pg_temp.u(n),'d37-'||n||'@example.test','{}'::jsonb from generate_series(1,5) n;
update public.profiles set approval_status='approved';
update public.profiles set role='admin', is_super_admin=true where id in (pg_temp.u(1),pg_temp.u(2));
update public.profiles set role='admin',admin_scopes=array['payments'] where id=pg_temp.u(3);
insert into public.events(id,slug,title,registration_fee,registration_open,is_live) values(pg_temp.u(10),'d37','D37',0,true,true);
insert into public.registrations(id,profile_id,event_id,amount,registration_status,payment_status)
values(pg_temp.u(11),pg_temp.u(4),pg_temp.u(10),0,'confirmed','verified'),
(pg_temp.u(12),pg_temp.u(5),pg_temp.u(10),0,'pending','unpaid');
set role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.u(3)::text,false);
select pg_temp.expect_error('select public.email_delivery_summary()','FORBIDDEN');
select pg_temp.expect_error(format('select public.claim_registration_email_resend(%L,%L)',pg_temp.u(11),pg_temp.u(20)),'FORBIDDEN');
select set_config('request.jwt.claim.sub',pg_temp.u(4)::text,false);
select pg_temp.expect_error('select public.email_delivery_summary()','FORBIDDEN');
select pg_temp.expect_error(format('select public.claim_registration_email_resend(%L,%L)',pg_temp.u(11),pg_temp.u(20)),'FORBIDDEN');
select set_config('request.jwt.claim.sub','',false);
select pg_temp.expect_error('select public.email_delivery_summary()','AUTH_REQUIRED');
select set_config('request.jwt.claim.sub',pg_temp.u(1)::text,false);
select pg_temp.expect_error('select public.claim_registration_email_resend(null,null)','INVALID_REQUEST');
select pg_temp.expect_error(format('select public.claim_registration_email_resend(%L,%L)',pg_temp.u(99),pg_temp.u(20)),'REGISTRATION_NOT_FOUND');
select pg_temp.expect_error(format('select public.claim_registration_email_resend(%L,%L)',pg_temp.u(12),pg_temp.u(20)),'REGISTRATION_NOT_CONFIRMED');
select pg_temp.check(public.claim_registration_email_resend(pg_temp.u(11),pg_temp.u(20)),'first claim');
select pg_temp.check(not public.claim_registration_email_resend(pg_temp.u(11),pg_temp.u(20)),'same request is idempotent false');
select pg_temp.check(not public.claim_registration_email_resend(pg_temp.u(11),pg_temp.u(21)),'cooldown false');
select set_config('request.jwt.claim.sub',pg_temp.u(2)::text,false);
select pg_temp.expect_error(format('select public.claim_registration_email_resend(%L,%L)',pg_temp.u(11),pg_temp.u(20)),'REQUEST_ID_REUSED');
select pg_temp.check(not public.claim_registration_email_resend(pg_temp.u(11),pg_temp.u(22)),'cooldown shared across admins');
select set_config('request.jwt.claim.sub',pg_temp.u(1)::text,false);
select pg_temp.expect_error(format('select public.claim_registration_email_resend(%L,%L)',pg_temp.u(12),pg_temp.u(20)),'REQUEST_ID_REUSED');
reset role;
select pg_temp.check((select count(*)=1 and bool_and(actor_id=pg_temp.u(1)) from public.registration_email_resend_claims),'only accepted claim persisted with derived actor');
select pg_temp.check((select count(*)=0 from public.email_delivery_log),'claims do not send/log email');
update public.registrations set registration_status='cancelled' where id=pg_temp.u(11);
set role authenticated;
select pg_temp.expect_error(format('select public.claim_registration_email_resend(%L,%L)',pg_temp.u(11),pg_temp.u(23)),'REGISTRATION_NOT_CONFIRMED');
reset role;
-- Exercise real service insertion (shim intentionally lacks service schema usage).
set role service_role;
insert into public.email_delivery_log(kind,outcome,source,actor_id) values('welcome','sent','automatic',null);
insert into public.email_delivery_log(kind,outcome,source,actor_id,error_class,error_code) values('smtp_check','failed','check',pg_temp.u(1),'authentication','EAUTH');
select pg_temp.expect_error($q$insert into public.email_delivery_log(kind,outcome,source,actor_id,error_class) values('welcome','failed','automatic',null,'recipient@example.test')$q$,'check constraint');
select pg_temp.expect_error($q$insert into public.email_delivery_log(kind,outcome,source,actor_id,error_code) values('welcome','failed','automatic',null,'recipient@example.test')$q$,'check constraint');
select pg_temp.expect_error($q$insert into public.email_delivery_log(kind,outcome,source,actor_id,provider_message_id) values('welcome','sent','automatic',null,'recipient@example.test')$q$,'check constraint');
select pg_temp.expect_error($q$insert into public.email_delivery_log(kind,outcome,actor_id) values('welcome','sent',null)$q$,'null value');
select pg_temp.expect_error($q$insert into public.email_delivery_log(kind,outcome,source,actor_id) values('registration_confirmed','sent','manual',null)$q$,'check constraint');
reset role;
insert into public.email_delivery_log(kind,outcome,source,actor_id,created_at) values('welcome','failed','automatic',null,now()-interval '8 days');
set role authenticated;
select pg_temp.check((select sum(attempts)=2 and count(*)=2 from public.email_delivery_summary()),'summary aggregates recent seven days only');
select pg_temp.expect_error('select * from public.email_delivery_log','permission denied');
reset role;
select pg_temp.expect_error('update public.email_delivery_log set outcome=outcome','EMAIL_AUDIT_APPEND_ONLY');
select pg_temp.expect_error('delete from public.email_delivery_log','EMAIL_AUDIT_APPEND_ONLY');
select pg_temp.expect_error('truncate public.email_delivery_log','EMAIL_AUDIT_APPEND_ONLY');
select pg_temp.expect_error('update public.registration_email_resend_claims set actor_id=actor_id','EMAIL_AUDIT_APPEND_ONLY');
select pg_temp.expect_error('delete from public.registration_email_resend_claims','EMAIL_AUDIT_APPEND_ONLY');
select pg_temp.expect_error('truncate public.registration_email_resend_claims','EMAIL_AUDIT_APPEND_ONLY');
-- An old accepted claim permits a new attempt; rejected states remain rejected.
insert into public.registration_email_resend_claims(request_id,registration_id,throttle_registration_id,actor_id,created_at)
values(pg_temp.u(24),pg_temp.u(12),pg_temp.u(12),pg_temp.u(1),now()-interval '61 seconds');
update public.registrations set registration_status='confirmed',payment_status='unpaid' where id=pg_temp.u(12);
set role authenticated;
select pg_temp.expect_error(format('select public.claim_registration_email_resend(%L,%L)',pg_temp.u(12),pg_temp.u(25)),'REGISTRATION_NOT_CONFIRMED');
reset role;
update public.registrations set payment_status='verified' where id=pg_temp.u(12);
set role authenticated;
select pg_temp.check(public.claim_registration_email_resend(pg_temp.u(12),pg_temp.u(25)),'cooldown expires after 60 seconds');
reset role;
set role service_role;
insert into public.email_delivery_log(kind,outcome,registration_id,actor_id,source,provider_message_id)
values('registration_confirmed','sent',pg_temp.u(12),pg_temp.u(1),'manual',repeat('a',64));
insert into public.email_delivery_log(kind,outcome,actor_id,source,error_code)
values('smtp_check','verified',pg_temp.u(1),'check',null),('payment_status','not_configured',null,'automatic','NOT_CONFIGURED');
select pg_temp.expect_error($q$insert into public.email_delivery_log(kind,outcome,actor_id,source) values('welcome','verified',null,'automatic')$q$,'check constraint');
select pg_temp.expect_error($q$insert into public.email_delivery_log(kind,outcome,actor_id,source) values('smtp_check','sent',null,'automatic')$q$,'check constraint');
select pg_temp.expect_error($q$insert into public.email_delivery_log(kind,outcome,actor_id,source) values('welcome','sent','00000000-0000-0000-0000-000000003701','automatic')$q$,'check constraint');
select pg_temp.expect_error($q$insert into public.email_delivery_log(kind,outcome,actor_id,source,provider_message_id) values('welcome','sent',null,'automatic','opaque-but-not-hashed')$q$,'check constraint');
reset role;
select pg_temp.check((select bool_and(relrowsecurity) from pg_class where oid in ('public.email_delivery_log'::regclass,'public.registration_email_resend_claims'::regclass)),'both audit tables have RLS enabled');
set role service_role;
insert into public.email_delivery_log(kind,outcome,registration_id,actor_id,source,error_class,error_code)
values('registration_confirmed','failed',null,pg_temp.u(1),'manual','unknown','UNKNOWN');
reset role;
select pg_temp.check((select count(*)=1 from public.email_delivery_log where source='manual' and registration_id is null),'invalid manual input is auditable without registration ID');
insert into auth.users(id,email) values(pg_temp.u(6),'team6@example.test'),(pg_temp.u(7),'team7@example.test');
insert into public.teams(id,event_id,head_profile_id) values(pg_temp.u(39),pg_temp.u(10),pg_temp.u(6));
insert into public.registrations(id,profile_id,event_id,amount,registration_status,payment_status,team_id,is_team_head)
values(pg_temp.u(40),pg_temp.u(6),pg_temp.u(10),0,'confirmed','verified',pg_temp.u(39),true),
(pg_temp.u(41),pg_temp.u(7),pg_temp.u(10),0,'confirmed','verified',pg_temp.u(39),false);
set role authenticated;
select pg_temp.check(public.claim_registration_email_resend(pg_temp.u(41),pg_temp.u(42)),'teammate claim accepted');
select pg_temp.check(not public.claim_registration_email_resend(pg_temp.u(40),pg_temp.u(43)),'head shares teammate cooldown');
select pg_temp.expect_error(format('select public.claim_registration_email_resend(%L,%L)',pg_temp.u(40),pg_temp.u(42)),'REQUEST_ID_REUSED');
reset role;
select pg_temp.check((select registration_id=pg_temp.u(41) and throttle_registration_id=pg_temp.u(40) from public.registration_email_resend_claims where request_id=pg_temp.u(42)),'original request target retained; canonical head throttled');
