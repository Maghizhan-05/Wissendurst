-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0034: additive per-event administrators; private event WhatsApp links;
-- per-event payment review.
\set ON_ERROR_STOP 1
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
\ir ../migrations/0034_event_admins_private_links.sql

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
  select ('00000000-0000-0000-0000-0000000034' || lpad(p_n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.as_user(p_n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, false) $$;
create or replace function pg_temp.ev(p_slug text) returns uuid language sql stable security definer as $$
  select id from public.events where slug = p_slug $$;
create or replace function pg_temp.reg(p_n int, p_slug text) returns public.registrations language sql stable security definer as $$
  select * from public.registrations where profile_id = pg_temp.u(p_n) and event_id = pg_temp.ev(p_slug) $$;
create or replace function pg_temp.perm(p_n int, p_slug text, p_perm text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform pg_temp.as_user(p_n);
  set local role authenticated;
  v := public.has_event_permission(pg_temp.ev(p_slug), p_perm);
  reset role;
  return v;
end $$;

-- 0 super · 1 global events · 2 global payments · 3 content-only · 4 event admin (events on ea)
-- 5 event admin (payments on ea) · 6/7/8 participants · 9 pending account · 10 role-admin event admin
insert into auth.users (id, email, raw_user_meta_data)
select pg_temp.u(n), 'e'||n||'@x.test', json_build_object('full_name','E'||n)::jsonb from generate_series(0, 10) n;
update public.profiles set approval_status = 'approved' where id <> pg_temp.u(9);
update public.profiles set role = 'admin', is_super_admin = true, admin_scopes = array['signups','events','payments','content'] where id = pg_temp.u(0);
update public.profiles set role = 'admin', admin_scopes = array['events'] where id = pg_temp.u(1);
update public.profiles set role = 'admin', admin_scopes = array['payments'] where id = pg_temp.u(2);
update public.profiles set role = 'admin', admin_scopes = array['content'] where id = pg_temp.u(3);
update public.profiles set role = 'admin', admin_scopes = '{}' where id = pg_temp.u(10);
insert into public.events (slug, title, short_description, registration_fee, registration_open, is_live, rules) values
  ('ea', 'Event A', 'Event A short', 10000, true, true, '["Old one-line rule", "Second"]'::jsonb),
  ('eb', 'Event B', 'Event B short', 10000, true, true, '[]'::jsonb),
  ('pp', 'Parent', 'Parent short', 0, true, true, '[]'::jsonb);
insert into public.events (slug, title, short_description, registration_fee, registration_open, is_live, parent_event_id)
values ('pc', 'Child', 'Child short', 0, true, true, pg_temp.ev('pp'));

create temp table snap_profiles as select id, role, is_super_admin, admin_scopes, participant_id from public.profiles;
grant select on snap_profiles to authenticated;

-- ── 1. privileges ───────────────────────────────────────────────────────────
select pg_temp.check(not has_table_privilege('anon', 'public.event_admin_assignments', 'select')
  and not has_table_privilege('authenticated', 'public.event_admin_assignments', 'insert')
  and not has_table_privilege('authenticated', 'public.event_admin_assignments', 'update')
  and not has_table_privilege('authenticated', 'public.event_admin_assignments', 'delete')
  and has_table_privilege('authenticated', 'public.event_admin_assignments', 'select'),
  '1: assignments are read-only to signed-in users and closed to anon');
select pg_temp.check(not has_table_privilege('anon', 'public.event_private_settings', 'select')
  and not has_table_privilege('authenticated', 'public.event_private_settings', 'select')
  and not has_table_privilege('authenticated', 'public.event_private_settings', 'insert')
  and not has_table_privilege('authenticated', 'public.event_private_settings', 'update')
  and has_table_privilege('service_role', 'public.event_private_settings', 'select'),
  '1: private event settings are unreadable to anon/authenticated; service role can read');
select pg_temp.check(not has_function_privilege('anon', 'public.super_set_event_admin(uuid, uuid, text[])', 'execute')
  and not has_function_privilege('anon', 'public.admin_get_event_whatsapp_link(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_set_event_whatsapp_link(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.event_admin_update_event_details(uuid, text, text, text, text, date, time, time, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.has_event_permission(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.super_set_event_admin(uuid, uuid, text[])', 'execute'),
  '1: anon cannot execute any 0034 RPC');
select pg_temp.check(not exists (select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'events' and column_name ilike '%whatsapp%'),
  '1: the public events row carries no WhatsApp column');

-- ── 2. assignment RPC: super admin only, validated, normalized ─────────────
set role authenticated;
select pg_temp.as_user(1);
select pg_temp.expect_error($q$select public.super_set_event_admin(pg_temp.u(4), pg_temp.ev('ea'), array['events'])$q$, 'FORBIDDEN');
select pg_temp.as_user(4);
select pg_temp.expect_error($q$select public.super_set_event_admin(pg_temp.u(4), pg_temp.ev('ea'), array['events','payments'])$q$, 'FORBIDDEN');
select pg_temp.as_user(0);
select pg_temp.expect_error($q$select public.super_set_event_admin(pg_temp.u(4), pg_temp.ev('ea'), array['content'])$q$, 'INVALID_EVENT_PERMISSION');
select pg_temp.expect_error($q$select public.super_set_event_admin(pg_temp.u(4), pg_temp.ev('ea'), array['events', null])$q$, 'INVALID_EVENT_PERMISSION');
select pg_temp.expect_error($q$select public.super_set_event_admin(pg_temp.u(9), pg_temp.ev('ea'), array['events'])$q$, 'USER_NOT_APPROVED');
select pg_temp.expect_error($q$select public.super_set_event_admin(gen_random_uuid(), pg_temp.ev('ea'), array['events'])$q$, 'USER_NOT_FOUND');
select pg_temp.expect_error($q$select public.super_set_event_admin(pg_temp.u(4), gen_random_uuid(), array['events'])$q$, 'EVENT_NOT_FOUND');
select pg_temp.expect_error($q$select public.super_set_event_admin(pg_temp.u(4), pg_temp.ev('pp'), array['events'])$q$, 'EVENT_IS_BROADER');
select public.super_set_event_admin(pg_temp.u(4), pg_temp.ev('ea'), array['events', 'events']);
select public.super_set_event_admin(pg_temp.u(5), pg_temp.ev('ea'), array['payments']);
select public.super_set_event_admin(pg_temp.u(10), pg_temp.ev('eb'), array['payments', 'events']);
select public.super_set_event_admin(pg_temp.u(6), pg_temp.ev('eb'), array['events']);
select public.super_set_event_admin(pg_temp.u(6), pg_temp.ev('eb'), '{}');   -- removal
reset role;
select pg_temp.check((select permissions from public.event_admin_assignments where profile_id = pg_temp.u(4)) = array['events']
  and (select permissions from public.event_admin_assignments where profile_id = pg_temp.u(10)) = array['events','payments']
  and (select assigned_by from public.event_admin_assignments where profile_id = pg_temp.u(5)) = pg_temp.u(0),
  '2: permissions are de-duplicated and sorted; assigner recorded');
select pg_temp.check(not exists (select 1 from public.event_admin_assignments where profile_id = pg_temp.u(6)),
  '2: an empty permission list removes the assignment');
select pg_temp.check(not exists (
  select 1 from public.profiles p join snap_profiles s using (id)
  where (p.role, p.is_super_admin, p.admin_scopes, p.participant_id) is distinct from (s.role, s.is_super_admin, s.admin_scopes, s.participant_id)),
  '2: assignments never change any role, scope or participant ID');
select pg_temp.expect_error($q$insert into public.event_admin_assignments (event_id, profile_id, permissions) values (pg_temp.ev('eb'), pg_temp.u(7), array['content'])$q$, 'event_admin_assignments_permissions_check');

-- direct client writes are refused
set role authenticated;
select pg_temp.as_user(4);
select pg_temp.expect_error($q$insert into public.event_admin_assignments (event_id, profile_id, permissions) values (pg_temp.ev('eb'), pg_temp.u(4), array['events'])$q$, 'permission denied');
select pg_temp.expect_error($q$update public.event_admin_assignments set permissions = array['events','payments']$q$, 'permission denied');
select pg_temp.check((select count(*) from public.event_admin_assignments) = 1, '2: an event admin reads only its own assignment');
select pg_temp.as_user(1);
select pg_temp.check((select count(*) from public.event_admin_assignments) = 0, '2: a global events admin does not read other accounts'' assignments');
select pg_temp.as_user(0);
select pg_temp.check((select count(*) from public.event_admin_assignments) = 3, '2: the super admin reads every assignment');
reset role;

-- ── 3. authorization resolution (global scopes preserved, assignments additive)
select pg_temp.check(pg_temp.perm(0, 'ea', 'events') and pg_temp.perm(0, 'eb', 'payments'), '3: super admin has every event permission');
select pg_temp.check(pg_temp.perm(1, 'ea', 'events') and pg_temp.perm(1, 'eb', 'events') and not pg_temp.perm(1, 'ea', 'payments'),
  '3: global events scope keeps site-wide events reach (and nothing more)');
select pg_temp.check(pg_temp.perm(2, 'ea', 'payments') and pg_temp.perm(2, 'eb', 'payments') and not pg_temp.perm(2, 'ea', 'events'),
  '3: global payments scope keeps site-wide payments reach (and nothing more)');
select pg_temp.check(not pg_temp.perm(3, 'ea', 'events') and not pg_temp.perm(3, 'ea', 'payments'), '3: content scope grants no event permission');
select pg_temp.check(pg_temp.perm(4, 'ea', 'events') and not pg_temp.perm(4, 'eb', 'events') and not pg_temp.perm(4, 'ea', 'payments'),
  '3: an events assignment covers exactly its event and permission');
select pg_temp.check(pg_temp.perm(5, 'ea', 'payments') and not pg_temp.perm(5, 'ea', 'events') and not pg_temp.perm(5, 'eb', 'payments'),
  '3: a payments assignment covers exactly its event and permission');
select pg_temp.check(pg_temp.perm(10, 'eb', 'events') and pg_temp.perm(10, 'eb', 'payments') and not pg_temp.perm(10, 'ea', 'events'),
  '3: a role-admin with no scopes gets only its assigned event');
select pg_temp.check(not pg_temp.perm(6, 'ea', 'events') and not pg_temp.perm(4, 'ea', 'content') and not pg_temp.perm(4, 'ea', null),
  '3: participants, unknown and null permissions are refused');
-- an assignment stops working when the account is no longer approved
update public.profiles set approval_status = 'pending' where id = pg_temp.u(4);
select pg_temp.check(not pg_temp.perm(4, 'ea', 'events'), '3: assignments of non-approved accounts are inert');
update public.profiles set approval_status = 'approved' where id = pg_temp.u(4);
-- existing global policies are untouched
select pg_temp.check((select count(*) from pg_policies where schemaname = 'public' and tablename = 'events' and policyname = 'events_admin_write'
  and qual like '%has_admin_scope(''events''::text)%') = 1
  and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'registrations' and policyname = 'reg_admin_write') = 1,
  '3: global events/registrations policies are unchanged');

-- ── 4. event details RPC: only descriptive fields of the assigned event ─────
create temp table snap_ea as select * from public.events where slug = 'ea';
grant select on snap_ea to authenticated;
set role authenticated;
select pg_temp.as_user(4);
select public.event_admin_update_event_details(pg_temp.ev('ea'), '  New short text ', 'Body', 'Final years', 'Hall 2',
  '2027-02-01', '09:30', '11:00', '["Paragraph one\nstill one", "Paragraph two"]'::jsonb);
select pg_temp.expect_error($q$select public.event_admin_update_event_details(pg_temp.ev('eb'), 'Short text', '', '', '', null, null, null, '[]')$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$select public.event_admin_update_event_details(pg_temp.ev('ea'), 'abc', '', '', '', null, null, null, '[]')$q$, 'INVALID_EVENT_DETAILS');
select pg_temp.expect_error($q$select public.event_admin_update_event_details(pg_temp.ev('ea'), 'Short text', '', '', '', null, null, null, '["ok", 3]')$q$, 'INVALID_EVENT_RULES');
select pg_temp.expect_error($q$select public.event_admin_update_event_details(pg_temp.ev('ea'), 'Short text', '', '', '', null, null, null, '["ok", "  "]')$q$, 'INVALID_EVENT_RULES');
select pg_temp.expect_error($q$select public.event_admin_update_event_details(pg_temp.ev('ea'), 'Short text', '', '', '', null, null, null, '{"a":1}')$q$, 'INVALID_EVENT_RULES');
-- the event admin has no direct table write
update public.events set title = 'Hijacked', registration_fee = 1 where slug = 'ea';
select pg_temp.as_user(5);
select pg_temp.expect_error($q$select public.event_admin_update_event_details(pg_temp.ev('ea'), 'Short text', '', '', '', null, null, null, '[]')$q$, 'FORBIDDEN');
select pg_temp.as_user(6);
select pg_temp.expect_error($q$select public.event_admin_update_event_details(pg_temp.ev('ea'), 'Short text', '', '', '', null, null, null, '[]')$q$, 'FORBIDDEN');
reset role;
select pg_temp.check(e.short_description = 'New short text' and e.description = 'Body' and e.eligibility = 'Final years'
  and e.venue = 'Hall 2' and e.event_date = '2027-02-01' and e.start_time = '09:30' and e.end_time = '11:00'
  and e.rules = '["Paragraph one\nstill one", "Paragraph two"]'::jsonb, '4: descriptive details saved, paragraph line breaks kept')
from public.events e where e.slug = 'ea';
select pg_temp.check(e.title = s.title and e.slug = s.slug and e.category = s.category and e.registration_fee = s.registration_fee
  and e.max_participants is not distinct from s.max_participants and e.parent_event_id is not distinct from s.parent_event_id
  and e.registration_open = s.registration_open and e.featured = s.featured and e.is_live = s.is_live
  and e.archived_at is not distinct from s.archived_at and e.upi_id is not distinct from s.upi_id,
  '4: title/slug/category/fee/capacity/hierarchy/flags unchanged by event admins')
from public.events e, snap_ea s where e.slug = 'ea';

-- ── 5. private WhatsApp link ────────────────────────────────────────────────
set role authenticated;
select pg_temp.as_user(4);
select public.admin_set_event_whatsapp_link(pg_temp.ev('ea'), ' https://chat.whatsapp.com/AbCdEfGhIj1234 ');
select pg_temp.check(public.admin_get_event_whatsapp_link(pg_temp.ev('ea')) = 'https://chat.whatsapp.com/AbCdEfGhIj1234',
  '5: an events assignee saves and reads its event link (trimmed)');
select pg_temp.expect_error($q$select public.admin_set_event_whatsapp_link(pg_temp.ev('ea'), 'https://evil.example/AbCdEfGhIj1234')$q$, 'INVALID_WHATSAPP_LINK');
select pg_temp.expect_error($q$select public.admin_set_event_whatsapp_link(pg_temp.ev('ea'), 'http://chat.whatsapp.com/AbCdEfGhIj1234')$q$, 'INVALID_WHATSAPP_LINK');
select pg_temp.expect_error($q$select public.admin_set_event_whatsapp_link(pg_temp.ev('ea'), 'https://chat.whatsapp.com/AbCd"><script>')$q$, 'INVALID_WHATSAPP_LINK');
select pg_temp.expect_error($q$select public.admin_set_event_whatsapp_link(pg_temp.ev('eb'), 'https://chat.whatsapp.com/AbCdEfGhIj1234')$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$select public.admin_get_event_whatsapp_link(pg_temp.ev('eb'))$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$select * from public.event_private_settings$q$, 'permission denied');
select pg_temp.as_user(5);
select pg_temp.expect_error($q$select public.admin_get_event_whatsapp_link(pg_temp.ev('ea'))$q$, 'FORBIDDEN');
select pg_temp.as_user(6);
select pg_temp.expect_error($q$select public.admin_get_event_whatsapp_link(pg_temp.ev('ea'))$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$select * from public.event_private_settings$q$, 'permission denied');
select pg_temp.as_user(1);
select public.admin_set_event_whatsapp_link(pg_temp.ev('eb'), 'https://chat.whatsapp.com/ZyXwVuTsRq9876?mode=r_c');
select pg_temp.check(public.admin_get_event_whatsapp_link(pg_temp.ev('eb')) = 'https://chat.whatsapp.com/ZyXwVuTsRq9876?mode=r_c',
  '5: a global events admin manages any event link');
select public.admin_set_event_whatsapp_link(pg_temp.ev('eb'), '  ');
select pg_temp.check(public.admin_get_event_whatsapp_link(pg_temp.ev('eb')) is null, '5: a blank link clears it');
reset role;
set role anon;
select pg_temp.expect_error($q$select * from public.event_private_settings$q$, 'permission denied');
select pg_temp.expect_error($q$select public.admin_get_event_whatsapp_link(pg_temp.ev('ea'))$q$, 'permission denied');
reset role;
select pg_temp.expect_error($q$insert into public.event_private_settings (event_id, whatsapp_group_url) values (pg_temp.ev('pc'), 'javascript:alert(1)')$q$, 'event_private_settings_whatsapp_check');
select pg_temp.check((select count(*) from public.event_private_settings where whatsapp_group_url is not null) = 1,
  '5: exactly the one saved link is stored');

-- ── 6. per-event payment review ─────────────────────────────────────────────
set role authenticated;
select pg_temp.as_user(6);
select (public.register_for_event(pg_temp.ev('ea'))).id is not null;
select (public.submit_payment((pg_temp.reg(6, 'ea')).id, 'UTR34000001', 'shot-a.png')).payment_status = 'under_review';
select pg_temp.as_user(7);
select (public.register_for_event(pg_temp.ev('eb'))).id is not null;
select (public.submit_payment((pg_temp.reg(7, 'eb')).id, 'UTR34000002', 'shot-b.png')).payment_status = 'under_review';
select pg_temp.as_user(8);
select (public.register_for_event(pg_temp.ev('ea'))).id is not null;
select (public.submit_payment((pg_temp.reg(8, 'ea')).id, 'UTR34000003', 'shot-c.png')).payment_status = 'under_review';

select pg_temp.as_user(5);   -- payments on ea only
select pg_temp.check((public.admin_set_payment_status((pg_temp.reg(6, 'ea')).id, 'verified', null)).registration_status = 'confirmed',
  '6: a payments assignee verifies its own event''s payment');
select pg_temp.expect_error($q$select public.admin_set_payment_status((pg_temp.reg(7, 'eb')).id, 'verified', null)$q$, 'FORBIDDEN');
select pg_temp.as_user(4);   -- events (not payments) on ea
select pg_temp.expect_error($q$select public.admin_set_payment_status((pg_temp.reg(8, 'ea')).id, 'verified', null)$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$select public.admin_set_payment_status(gen_random_uuid(), 'verified', null)$q$, 'FORBIDDEN');
select pg_temp.as_user(6);   -- participant: refused before any lookup
select pg_temp.expect_error($q$select public.admin_set_payment_status(gen_random_uuid(), 'verified', null)$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$select public.admin_set_payment_status((pg_temp.reg(8, 'ea')).id, 'verified', null)$q$, 'FORBIDDEN');
select pg_temp.as_user(3);   -- content admin
select pg_temp.expect_error($q$select public.admin_set_payment_status((pg_temp.reg(8, 'ea')).id, 'verified', null)$q$, 'FORBIDDEN');
select pg_temp.as_user(2);   -- global payments: site-wide, unchanged
select pg_temp.check((public.admin_set_payment_status((pg_temp.reg(7, 'eb')).id, 'rejected', 'Blurry')).registration_status = 'rejected',
  '6: global payments scope still reviews every event');
select pg_temp.expect_error($q$select public.admin_set_payment_status(gen_random_uuid(), 'verified', null)$q$, 'REGISTRATION_NOT_FOUND');
select pg_temp.as_user(10);  -- role-admin assignee: payments on eb only
select pg_temp.expect_error($q$select public.admin_set_payment_status((pg_temp.reg(8, 'ea')).id, 'verified', null)$q$, 'FORBIDDEN');
reset role;
select pg_temp.check((pg_temp.reg(8, 'ea')).payment_status = 'under_review' and (pg_temp.reg(7, 'eb')).payment_status = 'rejected'
  and (pg_temp.reg(6, 'ea')).verified_by = pg_temp.u(5),
  '6: refused reviews changed nothing; the verifier is recorded');
select pg_temp.check((select count(*) from public.payment_events where registration_id = (pg_temp.reg(6, 'ea')).id and action = 'admin_review' and actor_id = pg_temp.u(5)) = 1,
  '6: the per-event review is audited like a global one');

-- ── 7. deleting an unused event drops its assignment and private settings ──
set role authenticated;
select pg_temp.as_user(0);
select public.super_set_event_admin(pg_temp.u(7), pg_temp.ev('pc'), array['events']);
select public.admin_set_event_whatsapp_link(pg_temp.ev('pc'), 'https://chat.whatsapp.com/ChildGroup1234');
reset role;
delete from public.events where slug = 'pc';
select pg_temp.check(not exists (select 1 from public.event_admin_assignments where profile_id = pg_temp.u(7))
  and (select count(*) from public.event_private_settings) = 2, '7: assignment and private settings cascade with the event');
