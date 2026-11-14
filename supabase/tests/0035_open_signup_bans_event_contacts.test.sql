-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0035: approval-free sign-up with immediate ids; evidence-preserving bans;
-- private Google Form links; public event coordinators.
\set ON_ERROR_STOP 1
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
-- As on Supabase: the service role and signed-in users reach storage.objects (RLS decides).
grant usage on schema public, storage to service_role;
grant all on storage.objects to service_role, authenticated;
\ir ../migrations/0034_event_admins_private_links.sql
\ir ../migrations/0035_open_signup_bans_event_contacts.sql

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
  select ('00000000-0000-0000-0000-0000000035' || lpad(p_n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.as_user(p_n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, false) $$;
create or replace function pg_temp.ev(p_slug text) returns uuid language sql stable security definer as $$
  select id from public.events where slug = p_slug $$;
create or replace function pg_temp.reg(p_n int, p_slug text) returns public.registrations language sql stable security definer as $$
  select * from public.registrations where profile_id = pg_temp.u(p_n) and event_id = pg_temp.ev(p_slug) $$;
create or replace function pg_temp.pr(p_n int) returns public.profiles language sql stable security definer as $$
  select * from public.profiles where id = pg_temp.u(p_n) $$;
create or replace function pg_temp.card(p_n int, p_file text) returns text language sql as $$
  insert into storage.objects (bucket_id, name, owner) values ('id-cards', pg_temp.u(p_n)::text || '/' || p_file, pg_temp.u(p_n))
  returning name $$;
-- A sign-up as Supabase creates it (handle_new_user), with metadata.
create or replace function pg_temp.signup(p_n int, p_complete boolean default true) returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.u(p_n), 's'||p_n||'@x.test',
    case when p_complete
      then jsonb_build_object('full_name','Student '||p_n,'phone','+91 98765 432'||lpad(p_n::text,2,'0'),'college','Madras Medical College','course','MBBS','year','2')
      else jsonb_build_object('full_name','Student '||p_n) end) $$;
create or replace function pg_temp.perm(p_n int, p_slug text, p_perm text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform pg_temp.as_user(p_n);
  set local role authenticated;
  v := public.has_event_permission(pg_temp.ev(p_slug), p_perm);
  reset role;
  return v;
end $$;
create or replace function pg_temp.scope(p_n int, p_scope text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform pg_temp.as_user(p_n);
  set local role authenticated;
  v := public.has_admin_scope(p_scope);
  reset role;
  return v;
end $$;

-- 0 super · 1 users(signups) admin · 2 events admin · 3 payments admin · 4 per-event events admin (role user)
-- 5 per-event events admin with role admin + events scope (to be banned) · 6..9 participants · 10+ sign-ups
insert into auth.users (id, email, raw_user_meta_data)
select pg_temp.u(n), 'a'||n||'@x.test', jsonb_build_object('full_name','A'||n) from generate_series(0, 9) n;
update public.profiles set approval_status = 'approved' where id in (select pg_temp.u(n) from generate_series(0, 9) n);
update public.profiles set role = 'admin', is_super_admin = true, admin_scopes = array['signups','events','payments','content'] where id = pg_temp.u(0);
update public.profiles set role = 'admin', admin_scopes = array['signups'] where id = pg_temp.u(1);
update public.profiles set role = 'admin', admin_scopes = array['events'] where id = pg_temp.u(2);
update public.profiles set role = 'admin', admin_scopes = array['payments'] where id = pg_temp.u(3);
update public.profiles set role = 'admin', admin_scopes = array['events'] where id = pg_temp.u(5);
select public.participant_id_sync_role(pg_temp.u(n)) from generate_series(0, 9) n;
insert into public.events (slug, title, short_description, registration_fee, registration_open, is_live) values
  ('ea', 'Event A', 'Event A short', 10000, true, true),
  ('eb', 'Event B', 'Event B short', 0, true, true),
  ('et', 'Team event', 'Team short', 0, true, true);
update public.events set team_enabled = true, team_min = 1, team_max = 3 where slug = 'et';
insert into public.event_admin_assignments (event_id, profile_id, permissions)
values (pg_temp.ev('ea'), pg_temp.u(4), array['events']), (pg_temp.ev('ea'), pg_temp.u(5), array['events','payments']);

-- ── A1. privileges ──────────────────────────────────────────────────────────
select pg_temp.check(not has_function_privilege('authenticated', 'public.server_complete_signup(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.server_complete_signup(uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.server_complete_signup(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.activate_profile(uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.profile_activation_error(uuid)', 'execute'),
  'A1: activation entry points are server-only');

-- ── A2. approval-free sign-up: immediate permanent E id ────────────────────
select pg_temp.signup(10);
select pg_temp.check((pg_temp.pr(10)).approval_status = 'pending' and (pg_temp.pr(10)).participant_id is null,
  'A2: a brand-new auth user starts as an unfinished profile (no id)');
set role service_role;
select (public.server_complete_signup(pg_temp.u(10), pg_temp.card(10, 'card.png'))).participant_id is not null;
reset role;
select pg_temp.check((pg_temp.pr(10)).approval_status = 'approved' and (pg_temp.pr(10)).participant_id ~ '^W27/E/[0-9]{4}$'
  and (pg_temp.pr(10)).approved_by is null and (pg_temp.pr(10)).approved_at is not null
  and (pg_temp.pr(10)).id_card_path = pg_temp.u(10)::text || '/card.png',
  'A2: completing sign-up activates the profile with a W27/E id at once, with nobody as approver');
select pg_temp.check((select count(*) from public.participant_id_history where profile_id = pg_temp.u(10) and action = 'assigned') = 1
  and (select count(*) from public.profile_approval_events where profile_id = pg_temp.u(10) and from_status = 'pending' and to_status = 'approved' and actor is null) = 1,
  'A2: one id assignment and one activation event are recorded');
create temp table snap10 as select * from public.profiles where id = pg_temp.u(10);
set role service_role;
select (public.server_complete_signup(pg_temp.u(10), pg_temp.card(10, 'second.png'))).id is not null;   -- re-run / re-signup
reset role;
select pg_temp.check((select p.participant_id = s.participant_id and p.id_card_path = s.id_card_path and p.approved_at = s.approved_at
  from public.profiles p, snap10 s where p.id = s.id)
  and (select count(*) from public.participant_id_history where profile_id = pg_temp.u(10)) = 1,
  'A2: activation is idempotent and never overwrites an active account''s ID card or id');
-- invalid cards: other user's folder, missing object, incomplete details
select pg_temp.signup(11);
select pg_temp.signup(12, false);
select pg_temp.card(12, 'c.png');
set role service_role;
select pg_temp.expect_error($q$select public.server_complete_signup(pg_temp.u(11), pg_temp.u(12)::text || '/c.png')$q$, 'INVALID_ID_CARD');
select pg_temp.expect_error($q$select public.server_complete_signup(pg_temp.u(11), pg_temp.u(11)::text || '/never-uploaded.png')$q$, 'INVALID_ID_CARD');
select pg_temp.expect_error($q$select public.server_complete_signup(pg_temp.u(12), pg_temp.u(12)::text || '/c.png')$q$, 'PROFILE_INCOMPLETE');
reset role;
select pg_temp.check((pg_temp.pr(11)).approval_status = 'pending' and (pg_temp.pr(11)).id_card_path is null
  and (pg_temp.pr(12)).approval_status = 'pending' and (pg_temp.pr(12)).id_card_path is null and (pg_temp.pr(12)).participant_id is null,
  'A2: refused activations change nothing (no partial card path, no id)');

-- ── A3. the owner finishes an incomplete profile; approval is retired ──────
select pg_temp.card(12, 'mine.png');
set role authenticated;
select pg_temp.as_user(12);
select pg_temp.expect_error($q$select public.resubmit_my_application('X', '+91 9000000000', 'MMC', 'MBBS', '2', pg_temp.u(12)::text || '/mine.png')$q$, 'INVALID_PROFILE');
select (public.resubmit_my_application('Student 12', '+91 90000 00012', 'Madras Medical College', 'MBBS', '2', pg_temp.u(12)::text || '/mine.png')).approval_status = 'approved';
select pg_temp.expect_error($q$select public.resubmit_my_application('Student 12', '+91 90000 00012', 'MMC', 'MBBS', '2', pg_temp.u(12)::text || '/mine.png')$q$, 'APPLICATION_ALREADY_ACTIVE');
select pg_temp.as_user(1);
select pg_temp.expect_error($q$select public.admin_set_approval(pg_temp.u(11), 'approved')$q$, 'APPROVAL_RETIRED');
select pg_temp.expect_error($q$select public.admin_set_approval(pg_temp.u(11), 'rejected')$q$, 'APPROVAL_RETIRED');
select pg_temp.as_user(6);
select pg_temp.expect_error($q$select public.admin_set_approval(pg_temp.u(11), 'approved')$q$, 'FORBIDDEN');
reset role;
select pg_temp.check((pg_temp.pr(12)).participant_id ~ '^W27/E/' and (pg_temp.pr(12)).full_name = 'Student 12'
  and (pg_temp.pr(11)).approval_status = 'pending',
  'A3: self-completion activates with an id; retired approval changes nothing');

-- ── A4. legacy rejected applicant: resubmitting activates and reuses the lowest released number
select pg_temp.signup(13);
select public.participant_id_sync_role(pg_temp.u(13));                  -- still pending: no id
update public.profiles set approval_status = 'rejected' where id = pg_temp.u(13);
select pg_temp.card(13, 'new.png');
select public.participant_id_allocate(pg_temp.u(9), 'E');               -- no-op: already holds one
select public.participant_id_release(pg_temp.u(9), 'E');                -- frees u9's number
create temp table freed as select number from public.participant_id_released where namespace = 'E';
set role authenticated;
select pg_temp.as_user(13);
select (public.resubmit_my_application('Student 13', '+91 90000 00013', 'Madras Medical College', 'MBBS', '3', pg_temp.u(13)::text || '/new.png')).approval_status = 'approved';
reset role;
select pg_temp.check((select number from public.participant_id_allocations where profile_id = pg_temp.u(13)) = (select min(number) from freed)
  and (select count(*) from public.profile_approval_events where profile_id = pg_temp.u(13) and from_status = 'rejected' and to_status = 'approved') = 1,
  'A4: a legacy rejected profile activates on resubmission and takes the lowest released number');
select public.participant_id_sync_role(pg_temp.u(9));                   -- u9 back to an E id

-- ── A5. legacy backfill: complete pending profiles activate, others untouched
select pg_temp.signup(14);  select pg_temp.signup(15);  select pg_temp.signup(16, false);  select pg_temp.signup(17);
set role service_role;
update public.profiles set id_card_path = pg_temp.card(14, 'a.png'), created_at = now() - interval '2 days' where id = pg_temp.u(14);
update public.profiles set id_card_path = pg_temp.card(15, 'a.png'), created_at = now() - interval '3 days' where id = pg_temp.u(15);
update public.profiles set id_card_path = pg_temp.u(17)::text || '/missing.png' where id = pg_temp.u(17);   -- object never uploaded
reset role;
create temp table untouched as select * from public.profiles where id in (pg_temp.u(11), pg_temp.u(16), pg_temp.u(17));
\ir ../migrations/0035_open_signup_bans_event_contacts.sql
select pg_temp.check((pg_temp.pr(14)).approval_status = 'approved' and (pg_temp.pr(15)).approval_status = 'approved'
  and (select number from public.participant_id_allocations where profile_id = pg_temp.u(15))
    < (select number from public.participant_id_allocations where profile_id = pg_temp.u(14)),
  'A5: complete legacy pending profiles are activated, oldest sign-up first');
select pg_temp.check(not exists (select 1 from public.profiles p join untouched t using (id) where p::text <> t::text),
  'A5: incomplete legacy profiles keep every field exactly (nothing fabricated)');
select pg_temp.check((select count(*) from public.profiles where approval_status = 'approved' and participant_id is null) = 0
  and (select count(*) from public.participant_id_allocations a join public.profiles p on p.id = a.profile_id and p.participant_id = a.participant_id)
    = (select count(*) from public.profiles where participant_id is not null),
  'A5: every active profile holds exactly its allocated id');

-- ── B1. bans: super admin only, reasons required ───────────────────────────
set role authenticated;
select pg_temp.as_user(1);
select pg_temp.expect_error($q$select public.super_set_user_ban(pg_temp.u(6), true, 'spam')$q$, 'FORBIDDEN');
select pg_temp.as_user(2);
select pg_temp.expect_error($q$select public.super_set_user_ban(pg_temp.u(6), true, 'spam')$q$, 'FORBIDDEN');
select pg_temp.as_user(3);
select pg_temp.expect_error($q$select public.super_set_user_ban(pg_temp.u(6), true, 'spam')$q$, 'FORBIDDEN');
select pg_temp.as_user(4);
select pg_temp.expect_error($q$select public.super_set_user_ban(pg_temp.u(6), true, 'spam')$q$, 'FORBIDDEN');
select pg_temp.as_user(6);
select pg_temp.expect_error($q$select public.super_set_user_ban(pg_temp.u(7), true, 'spam')$q$, 'FORBIDDEN');
select pg_temp.as_user(0);
select pg_temp.expect_error($q$select public.super_set_user_ban(pg_temp.u(6), true, '   ')$q$, 'BAN_REASON_REQUIRED');
select pg_temp.expect_error($q$select public.super_set_user_ban(pg_temp.u(0), true, 'self')$q$, 'CANNOT_BAN_SELF');
select pg_temp.expect_error($q$select public.super_set_user_ban(gen_random_uuid(), true, 'x')$q$, 'USER_NOT_FOUND');
select pg_temp.expect_error($q$select public.super_set_user_ban(pg_temp.u(6), false, 'not banned yet')$q$, 'NOT_BANNED');
select pg_temp.expect_error($q$insert into public.profile_bans (profile_id, reason) values (pg_temp.u(6), 'direct')$q$, 'permission denied');
reset role;
select pg_temp.check(not has_table_privilege('authenticated', 'public.profile_bans', 'insert')
  and not has_table_privilege('authenticated', 'public.profile_ban_events', 'insert')
  and not has_table_privilege('anon', 'public.profile_bans', 'select')
  and not has_function_privilege('anon', 'public.super_set_user_ban(uuid, boolean, text)', 'execute'),
  'B1: ban tables are written only through the super-admin RPC');

-- evidence before banning: participant 6 has a registration and a payment submission
set role authenticated;
select pg_temp.as_user(6);
select (public.register_for_event(pg_temp.ev('ea'))).id is not null;
select (public.submit_payment((pg_temp.reg(6, 'ea')).id, 'UTR35000001', 'shot-6.png')).payment_status = 'under_review';
reset role;
create temp table ev_before as select
  (select p::text from public.profiles p where id = pg_temp.u(6)) prof,
  (select string_agg(r::text, ',' order by r.id) from public.registrations r where profile_id = pg_temp.u(6)) regs,
  (select string_agg(e::text, ',' order by e.id) from public.payment_events e join public.registrations r on r.id = e.registration_id where r.profile_id = pg_temp.u(6)) pays,
  (select string_agg(h::text, ',' order by h.id) from public.participant_id_history h where profile_id = pg_temp.u(6)) ids;

set role authenticated;
select pg_temp.as_user(0);
select public.super_set_user_ban(pg_temp.u(6), true, '  Fake ID card  ');
select public.super_set_user_ban(pg_temp.u(5), true, 'Abused admin access');
select pg_temp.expect_error($q$select public.super_set_user_ban(pg_temp.u(6), true, 'again')$q$, 'ALREADY_BANNED');
reset role;
update public.profiles set role = 'admin', is_super_admin = true where id = pg_temp.u(9);   -- a second super admin
set role authenticated;
select pg_temp.as_user(0);
select pg_temp.expect_error($q$select public.super_set_user_ban(pg_temp.u(9), true, 'x')$q$, 'CANNOT_BAN_SUPER_ADMIN');
reset role;
update public.profiles set role = 'user', is_super_admin = false where id = pg_temp.u(9);
select pg_temp.check((select reason = 'Fake ID card' and banned_by = pg_temp.u(0) from public.profile_bans where profile_id = pg_temp.u(6))
  and (select count(*) from public.profile_ban_events where profile_id = pg_temp.u(6) and action = 'ban' and actor = pg_temp.u(0) and reason = 'Fake ID card') = 1,
  'B1: ban state and audit row record actor, time and trimmed reason');

-- ── B2. a banned account can't act ─────────────────────────────────────────
set role authenticated;
select pg_temp.as_user(6);
select pg_temp.expect_error($q$select public.register_for_event(pg_temp.ev('eb'))$q$, 'ACCOUNT_BANNED');
select pg_temp.expect_error($q$select public.submit_payment((pg_temp.reg(6, 'ea')).id, 'UTR35000002', 'shot-6b.png')$q$, 'ACCOUNT_BANNED');
select pg_temp.expect_error($q$select public.update_my_profile('A6 New', '+91 90000 00006', 'MMC', 'MBBS', '2')$q$, 'ACCOUNT_BANNED');
select pg_temp.expect_error($q$insert into storage.objects (bucket_id, name, owner) values ('payment-screenshots', pg_temp.u(6)::text || '/x.png', pg_temp.u(6))$q$, 'row-level security');
select pg_temp.check((select count(*) from public.profile_bans) = 1, 'B2: an account reads only its own ban row');
-- nobody can enrol a banned account as a teammate
select pg_temp.as_user(7);
select pg_temp.expect_error($q$select public.register_team(pg_temp.ev('et'), array[pg_temp.u(6)], 'Crew')$q$, 'MEMBER_BANNED');
-- ...but an unbanned participant's own uploads still work
insert into storage.objects (bucket_id, name, owner) values ('payment-screenshots', pg_temp.u(7)::text || '/ok.png', pg_temp.u(7));
-- a banned admin / event assignee holds no admin power
reset role;
select pg_temp.check(not pg_temp.scope(5, 'events') and not pg_temp.perm(5, 'ea', 'events') and not pg_temp.perm(5, 'ea', 'payments')
  and pg_temp.scope(2, 'events') and pg_temp.perm(4, 'ea', 'events'),
  'B2: a banned admin loses global and per-event permissions; others keep theirs');
set role authenticated;
select pg_temp.as_user(5);
select pg_temp.expect_error($q$select public.admin_set_payment_status((pg_temp.reg(6, 'ea')).id, 'verified', null)$q$, 'FORBIDDEN');
select pg_temp.as_user(1);
select pg_temp.check((select count(*) from public.profile_bans) = 2 and (select count(*) from public.profile_ban_events) = 2,
  'B2: the Users-scope directory admin can read ban state and history');
reset role;
set role anon;
select pg_temp.expect_error($q$select * from public.profile_bans$q$, 'permission denied');
reset role;
-- admins still act on the banned account's records (e.g. reviewing its payment)
set role authenticated;
select pg_temp.as_user(3);
select (public.admin_set_payment_status((pg_temp.reg(6, 'ea')).id, 'verified', null)).registration_status = 'confirmed';
reset role;

-- ── B3. evidence preserved; append-only history; unban restores identity ──
select pg_temp.expect_error($q$update public.profile_ban_events set reason = 'edited'$q$, 'APPEND_ONLY');
select pg_temp.expect_error($q$delete from public.profile_ban_events$q$, 'APPEND_ONLY');
select pg_temp.expect_error($q$delete from public.profiles where id = pg_temp.u(6)$q$, 'violates foreign key constraint');
set role authenticated;
select pg_temp.as_user(0);
select public.super_set_user_ban(pg_temp.u(6), false, 'Appeal accepted');
select public.super_set_user_ban(pg_temp.u(5), false, 'Reinstated');
reset role;
select pg_temp.check((select prof from ev_before) = (select p::text from public.profiles p where id = pg_temp.u(6))
  and (select ids from ev_before) = (select string_agg(h::text, ',' order by h.id) from public.participant_id_history h where profile_id = pg_temp.u(6))
  and (select count(*) from public.registrations where profile_id = pg_temp.u(6)) = 1
  and (select count(*) from public.payment_events e join public.registrations r on r.id = e.registration_id where r.profile_id = pg_temp.u(6)) >= 2,
  'B3: ban + unban keep the profile, participant id and its history; registrations and payment evidence remain');
select pg_temp.check(not exists (select 1 from public.profile_bans)
  and (select string_agg(action || ':' || reason, ',' order by id) from public.profile_ban_events where profile_id = pg_temp.u(6)) = 'ban:Fake ID card,unban:Appeal accepted',
  'B3: unban clears the current state and appends to the history');
set role authenticated;
select pg_temp.as_user(6);
select (public.register_for_event(pg_temp.ev('eb'))).id is not null;
reset role;
select pg_temp.check((pg_temp.reg(6, 'eb')).registration_status = 'confirmed' and pg_temp.scope(5, 'events') and pg_temp.perm(5, 'ea', 'payments'),
  'B3: after unban the participant registers again and the admin regains its permissions');

-- ── C. private Google Form link ────────────────────────────────────────────
set role authenticated;
select pg_temp.as_user(4);
select public.admin_set_event_whatsapp_link(pg_temp.ev('ea'), 'https://chat.whatsapp.com/AbCdEfGhIj1234');
select public.admin_set_event_google_form_link(pg_temp.ev('ea'), ' https://forms.gle/AbC123xyz ');
select pg_temp.check(public.admin_get_event_google_form_link(pg_temp.ev('ea')) = 'https://forms.gle/AbC123xyz'
  and public.admin_get_event_whatsapp_link(pg_temp.ev('ea')) = 'https://chat.whatsapp.com/AbCdEfGhIj1234',
  'C: a per-event Events admin saves the form link; the WhatsApp link is untouched');
select public.admin_set_event_google_form_link(pg_temp.ev('ea'), 'https://docs.google.com/forms/d/e/1FAIpQLSc9Wx3mUq7Lr0bVQe8Tn2abc/viewform?usp=sf_link');
select public.admin_set_event_google_form_link(pg_temp.ev('ea'), 'https://docs.google.com/forms/d/1FAIpQLSc9Wx3mUq7Lr0bVQe8Tn2abc/formResponse');
select pg_temp.expect_error($q$select public.admin_set_event_google_form_link(pg_temp.ev('ea'), 'https://docs.google.com/forms/d/1FAIpQLSc9Wx3mUq7Lr0bVQe8Tn2abc/edit')$q$, 'INVALID_GOOGLE_FORM_LINK');
select pg_temp.expect_error($q$select public.admin_set_event_google_form_link(pg_temp.ev('ea'), 'http://forms.gle/AbC123xyz')$q$, 'INVALID_GOOGLE_FORM_LINK');
select pg_temp.expect_error($q$select public.admin_set_event_google_form_link(pg_temp.ev('ea'), 'https://forms.gle.evil.test/AbC123xyz')$q$, 'INVALID_GOOGLE_FORM_LINK');
select pg_temp.expect_error($q$select public.admin_set_event_google_form_link(pg_temp.ev('ea'), 'https://docs.google.com/document/d/1FAIpQLSc9Wx3mUq7Lr0bVQe8Tn2abc/edit')$q$, 'INVALID_GOOGLE_FORM_LINK');
select pg_temp.expect_error($q$select public.admin_set_event_google_form_link(pg_temp.ev('ea'), 'https://docs.google.com/forms/d/e/1FAIpQLSc9Wx3mUq7Lr0bVQe8Tn2abc/viewform?x="><script>')$q$, 'INVALID_GOOGLE_FORM_LINK');
select pg_temp.expect_error($q$select public.admin_set_event_google_form_link(pg_temp.ev('eb'), 'https://forms.gle/AbC123xyz')$q$, 'FORBIDDEN');
select public.admin_set_event_whatsapp_link(pg_temp.ev('ea'), '');
select pg_temp.check(public.admin_get_event_google_form_link(pg_temp.ev('ea')) like 'https://docs.google.com/forms/d/1FAIpQ%/formResponse'
  and public.admin_get_event_whatsapp_link(pg_temp.ev('ea')) is null,
  'C: clearing the WhatsApp link keeps the form link');
select pg_temp.as_user(3);   -- payments-only admin
select pg_temp.expect_error($q$select public.admin_get_event_google_form_link(pg_temp.ev('ea'))$q$, 'FORBIDDEN');
select pg_temp.as_user(7);   -- participant
select pg_temp.expect_error($q$select public.admin_set_event_google_form_link(pg_temp.ev('ea'), '')$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$select google_form_url from public.event_private_settings$q$, 'permission denied');
select pg_temp.as_user(2);   -- global events admin
select public.admin_set_event_google_form_link(pg_temp.ev('eb'), 'https://forms.gle/Global123');
select public.admin_set_event_google_form_link(pg_temp.ev('eb'), '   ');
select pg_temp.check(public.admin_get_event_google_form_link(pg_temp.ev('eb')) is null, 'C: a global Events admin manages any event; blank clears');
reset role;
set role anon;
select pg_temp.expect_error($q$select public.admin_get_event_google_form_link(pg_temp.ev('ea'))$q$, 'permission denied');
reset role;
select pg_temp.expect_error($q$update public.event_private_settings set google_form_url = 'https://evil.test/form' where event_id = pg_temp.ev('ea')$q$, 'event_private_settings_google_form_check');
select pg_temp.check(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'events' and column_name ilike '%form%'),
  'C: no form link column on the public events row');

-- ── D. public coordinators ─────────────────────────────────────────────────
select pg_temp.check((select bool_and(coordinators = '[]'::jsonb) from public.events), 'D: existing events default to no coordinators');
select pg_temp.check(public.event_coordinators_error('[]') is null
  and public.event_coordinators_error('[{"name":"Dr. Kavitha S","role":"Faculty coordinator","phone":"+91 98400 12345","email":"kavitha@smc.edu.in"},{"name":"Arjun","phone":"9003177881"},{"name":"Lakshmi","email":"l@x.in"}]') is null,
  'D: valid lists (phone only, email only, both) pass');
select pg_temp.check(public.event_coordinators_error('[{"name":"No contact"}]') = 'CONTACT_REQUIRED'
  and public.event_coordinators_error('[{"phone":"9003177881"}]') = 'INVALID_NAME'
  and public.event_coordinators_error('[{"name":" Padded","phone":"9003177881"}]') = 'UNTRIMMED_OR_EMPTY'
  and public.event_coordinators_error('[{"name":"A","phone":""}]') = 'UNTRIMMED_OR_EMPTY'
  and public.event_coordinators_error('[{"name":"A","phone":"call me"}]') = 'INVALID_PHONE'
  and public.event_coordinators_error('[{"name":"A","email":"a@b"}]') = 'INVALID_EMAIL'
  and public.event_coordinators_error('[{"name":"A","email":"a@b.in","twitter":"x"}]') = 'UNKNOWN_KEY'
  and public.event_coordinators_error('[{"name":"A","phone":9003177881}]') = 'NOT_STRING'
  and public.event_coordinators_error('{"name":"A"}') = 'NOT_ARRAY'
  and public.event_coordinators_error((select jsonb_agg(jsonb_build_object('name','N'||n,'phone','900317788'||(n % 10))) from generate_series(1, 11) n)) = 'TOO_MANY'
  and public.event_coordinators_error((select jsonb_agg(jsonb_build_object('name','N'||n,'phone','900317788'||(n % 10))) from generate_series(1, 10) n)) is null
  and public.event_coordinators_error(jsonb_build_array(jsonb_build_object('name', repeat('x', 81), 'phone', '9003177881'))) = 'INVALID_NAME'
  and public.event_coordinators_error(jsonb_build_array(jsonb_build_object('name', E'Line\nbreak', 'phone', '9003177881'))) = 'UNTRIMMED_OR_EMPTY',
  'D: every invalid shape is refused with its reason (max 10)');
select pg_temp.expect_error($q$update public.events set coordinators = '[{"name":"No contact"}]' where slug = 'ea'$q$, 'events_coordinators_valid');
set role authenticated;
select pg_temp.as_user(4);
select public.admin_set_event_coordinators(pg_temp.ev('ea'), '[{"name":"Dr. Kavitha S","role":"Faculty coordinator","phone":"+91 98400 12345"}]');
select pg_temp.expect_error($q$select public.admin_set_event_coordinators(pg_temp.ev('eb'), '[]')$q$, 'FORBIDDEN');
select pg_temp.expect_error($q$select public.admin_set_event_coordinators(pg_temp.ev('ea'), '[{"name":"No contact"}]')$q$, 'INVALID_COORDINATORS');
-- the existing details RPC keeps working and leaves coordinators alone
select public.event_admin_update_event_details(pg_temp.ev('ea'), 'Updated short', 'Body', '', '', null, null, null, '["Rule"]');
select pg_temp.as_user(3);
select pg_temp.expect_error($q$select public.admin_set_event_coordinators(pg_temp.ev('ea'), '[]')$q$, 'FORBIDDEN');
select pg_temp.as_user(7);
select pg_temp.expect_error($q$select public.admin_set_event_coordinators(pg_temp.ev('ea'), '[]')$q$, 'FORBIDDEN');
select pg_temp.as_user(2);
select public.admin_set_event_coordinators(pg_temp.ev('eb'), '[{"name":"Arjun","email":"arjun@smc.edu.in"}]');
reset role;
select pg_temp.check((select coordinators = '[{"name":"Dr. Kavitha S","role":"Faculty coordinator","phone":"+91 98400 12345"}]'::jsonb
  and short_description = 'Updated short' from public.events where slug = 'ea')
  and (select jsonb_array_length(coordinators) = 1 from public.events where slug = 'eb'),
  'D: per-event and global Events admins save coordinators; the details RPC leaves them unchanged');
set role anon;
select pg_temp.check((select coordinators ->> 0 is not null from public.events where slug = 'ea'), 'D: coordinators are public event content');
reset role;
