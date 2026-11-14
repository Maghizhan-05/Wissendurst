-- ============================================================================
-- WISSENDURST'27 — 0035_open_signup_bans_event_contacts
--
-- Pre-analytics restructuring, phase 4 (D-021 / D-023, approved).
--   A. Approval-free sign-up. A profile that completes the sign-up flow
--      (valid details + an uploaded college ID card) is activated at once and
--      receives its permanent W27/E id atomically through the existing
--      allocator (0021/0024): no organizer approval, no approval queue.
--        • server_complete_signup  — service role, right after sign-up.
--        • resubmit_my_application — the signed-in owner completes an
--          incomplete (or legacy rejected) profile; same signature as 0031.
--        • admin_set_approval      — retired (APPROVAL_RETIRED).
--      Complete legacy pending profiles are activated here; incomplete ones
--      keep their data untouched and complete themselves.
--   B. Evidence-preserving bans (super admin only). profile_bans is the
--      current state, profile_ban_events the append-only history. Nothing is
--      ever deleted or reallocated. A banned account can't act: triggers on
--      registrations/teams/general registrations/profiles, a restrictive
--      storage policy, and ban-aware admin/permission helpers.
--   C. Optional private Google Form link per event (event_private_settings),
--      editable with the Events permission (global or per event).
--   D. Optional public coordinator boxes on events (validated jsonb, max 10),
--      editable with the Events permission (global or per event).
-- Safe to re-run.
-- ============================================================================

-- ── A. approval-free activation ─────────────────────────────────────────────

-- Null when the profile is complete enough to activate, else a reason code.
-- Same limits as lib/validation/auth.ts (profileSchema) and 0031.
create or replace function public.profile_activation_error(p_profile_id uuid)
returns text
language sql stable security definer set search_path = public, storage as $$
  select case
    when p.id is null then 'PROFILE_NOT_FOUND'
    when char_length(btrim(coalesce(p.full_name, ''))) not between 2 and 80 then 'INVALID_NAME'
    when coalesce(btrim(p.phone), '') !~ '^[0-9+\-\s]{7,15}$' then 'INVALID_PHONE'
    when char_length(btrim(coalesce(p.college, ''))) not between 2 and 120 then 'INVALID_COLLEGE'
    when char_length(btrim(coalesce(p.course, ''))) not between 1 and 80 then 'INVALID_COURSE'
    when char_length(btrim(coalesce(p.year, ''))) not between 1 and 20 then 'INVALID_YEAR'
    when p.id_card_path is null
      or not exists (select 1 from storage.objects o where o.bucket_id = 'id-cards' and o.name = p.id_card_path)
      then 'ID_CARD_MISSING'
    else null end
  from (select 1) one
  left join public.profiles p on p.id = p_profile_id;
$$;
revoke execute on function public.profile_activation_error(uuid) from public, anon, authenticated;

-- Activates a complete profile: approved + permanent participant id in one
-- transaction. Idempotent for active profiles. Internal (no client grants).
create or replace function public.activate_profile(p_profile_id uuid, p_actor uuid, p_reason text)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_row public.profiles;
  v_err text;
begin
  -- Lock order: profile row, then (inside the allocator) namespace rows.
  select * into v_row from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if v_row.approval_status = 'approved' then
    if v_row.participant_id is null then
      perform public.participant_id_sync_role(p_profile_id, p_actor, coalesce(p_reason, 'activation'));
      select * into v_row from public.profiles where id = p_profile_id;
    end if;
    return v_row;                                             -- idempotent
  end if;
  v_err := public.profile_activation_error(p_profile_id);
  if v_err is not null then raise exception 'PROFILE_INCOMPLETE' using detail = v_err; end if;

  update public.profiles set
    approval_status = 'approved',
    approved_by = null,                                       -- nobody approved it
    approved_at = now()
  where id = p_profile_id;
  if not exists (select 1 from public.participant_id_allocations where profile_id = p_profile_id) then
    perform public.participant_id_sync_role(p_profile_id, p_actor, coalesce(p_reason, 'activation'));
  end if;
  insert into public.profile_approval_events (profile_id, from_status, to_status, actor, reason)
  values (p_profile_id, v_row.approval_status, 'approved', p_actor, left(coalesce(p_reason, 'activation'), 300));

  select * into v_row from public.profiles where id = p_profile_id;
  return v_row;
end $$;
revoke execute on function public.activate_profile(uuid, uuid, text) from public, anon, authenticated;

-- Server (service role) right after sign-up: attach the uploaded ID card to
-- the NEW pending profile and activate it. Never touches an active profile or
-- one that already has an ID card (an existing account can't be overwritten
-- by someone signing up again with its email).
create or replace function public.server_complete_signup(p_profile_id uuid, p_id_card_path text)
returns public.profiles
language plpgsql security definer set search_path = public, storage as $$
declare
  v_row public.profiles;
  v_path text := btrim(coalesce(p_id_card_path, ''));
begin
  select * into v_row from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if v_row.approval_status = 'approved' then return v_row; end if;
  if v_row.approval_status <> 'pending' then raise exception 'NOT_A_NEW_SIGNUP'; end if;
  if v_row.id_card_path is null then
    if v_path !~ ('^' || p_profile_id::text || '/[A-Za-z0-9._-]{1,120}$')
       or not exists (select 1 from storage.objects o where o.bucket_id = 'id-cards' and o.name = v_path) then
      raise exception 'INVALID_ID_CARD';
    end if;
    update public.profiles set id_card_path = v_path where id = p_profile_id;
  end if;
  return public.activate_profile(p_profile_id, null, 'approval-free sign-up');
end $$;
revoke execute on function public.server_complete_signup(uuid, text) from public, anon, authenticated;
grant execute on function public.server_complete_signup(uuid, text) to service_role;

-- Same signature as 0031: the signed-in owner of an incomplete (pending) or
-- legacy rejected profile corrects its details, uploads a new college ID card
-- and is activated at once.
create or replace function public.resubmit_my_application(
  p_full_name text,
  p_phone text,
  p_college text,
  p_course text,
  p_year text,
  p_id_card_path text
)
returns public.profiles
language plpgsql security definer set search_path = public, storage as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_college text := btrim(coalesce(p_college, ''));
  v_course text := btrim(coalesce(p_course, ''));
  v_year text := btrim(coalesce(p_year, ''));
  v_path text := btrim(coalesce(p_id_card_path, ''));
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_row from public.profiles where id = v_uid for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if v_row.approval_status = 'approved' then raise exception 'APPLICATION_ALREADY_ACTIVE'; end if;

  if char_length(v_name) not between 2 and 80
     or v_phone !~ '^[0-9+\-\s]{7,15}$'
     or char_length(v_college) not between 2 and 120
     or char_length(v_course) not between 1 and 80
     or char_length(v_year) not between 1 and 20 then
    raise exception 'INVALID_PROFILE';
  end if;
  -- A NEW ID card the caller uploaded to their own folder of the private bucket.
  if v_path !~ ('^' || v_uid::text || '/[A-Za-z0-9._-]{1,120}$')
     or v_path is not distinct from v_row.id_card_path
     or not exists (select 1 from storage.objects o where o.bucket_id = 'id-cards' and o.name = v_path) then
    raise exception 'INVALID_ID_CARD';
  end if;

  update public.profiles set
    full_name = v_name, phone = v_phone, college = v_college, course = v_course, year = v_year,
    id_card_path = v_path
  where id = v_uid;
  return public.activate_profile(v_uid, v_uid, 'profile completed by owner');
end $$;
revoke execute on function public.resubmit_my_application(text, text, text, text, text, text) from public, anon;
grant execute on function public.resubmit_my_application(text, text, text, text, text, text) to authenticated;

-- Manual approval is retired (same signature as 0021/0024/0031).
create or replace function public.admin_set_approval(p_user_id uuid, p_status approval_status)
returns public.profiles
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_admin_scope('signups') then raise exception 'FORBIDDEN'; end if;
  raise exception 'APPROVAL_RETIRED'
    using detail = 'sign-up is approval-free (0035); use a super-admin ban to block an account';
end $$;
revoke execute on function public.admin_set_approval(uuid, approval_status) from public, anon;
grant execute on function public.admin_set_approval(uuid, approval_status) to authenticated;

-- Legacy pending profiles that are already complete are activated (oldest
-- first, so ids follow sign-up order). Incomplete ones are left exactly as
-- they are; rejected ones keep their state until their owner resubmits.
do $$
declare r record;
begin
  for r in
    select p.id from public.profiles p
    where p.approval_status = 'pending' and p.role = 'user'
      and public.profile_activation_error(p.id) is null
    order by p.created_at, p.id
  loop
    perform public.activate_profile(r.id, null, 'approval-free sign-up (0035 backfill)');
  end loop;
end $$;

-- ── B. bans (super admin only, evidence-preserving) ────────────────────────
create table if not exists public.profile_bans (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  banned_at  timestamptz not null default now(),
  banned_by  uuid references public.profiles(id) on delete set null,
  reason     text not null check (char_length(btrim(reason)) between 1 and 300)
);
create table if not exists public.profile_ban_events (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  action     text not null check (action in ('ban', 'unban')),
  actor      uuid references public.profiles(id) on delete set null,
  reason     text not null check (char_length(btrim(reason)) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists profile_ban_events_profile_idx on public.profile_ban_events (profile_id, created_at);
drop trigger if exists profile_ban_events_append_only on public.profile_ban_events;
create trigger profile_ban_events_append_only
  before update or delete on public.profile_ban_events
  for each row execute function public.guard_append_only();

alter table public.profile_bans enable row level security;
alter table public.profile_ban_events enable row level security;
revoke all on public.profile_bans, public.profile_ban_events from public, anon, authenticated;
grant select on public.profile_bans, public.profile_ban_events to authenticated;
grant all on public.profile_bans, public.profile_ban_events to service_role;

create or replace function public.is_user_banned(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_profile_id is not null
     and exists (select 1 from public.profile_bans b where b.profile_id = p_profile_id);
$$;
revoke execute on function public.is_user_banned(uuid) from public, anon;
grant execute on function public.is_user_banned(uuid) to authenticated;

-- The account itself, user directory admins (Users scope) and the super
-- admin may read ban state/history; nobody writes except super_set_user_ban.
drop policy if exists profile_bans_read on public.profile_bans;
create policy profile_bans_read on public.profile_bans
  for select using (profile_id = auth.uid() or public.has_admin_scope('signups'));
drop policy if exists profile_ban_events_read on public.profile_ban_events;
create policy profile_ban_events_read on public.profile_ban_events
  for select using (profile_id = auth.uid() or public.has_admin_scope('signups'));

-- Admin/permission helpers: a banned account holds no admin power. (Super
-- admins can't be banned, but a banned account later promoted stays inert.)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ) and not public.is_user_banned(auth.uid());
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_super_admin
  ) and not public.is_user_banned(auth.uid());
$$;

create or replace function public.has_admin_scope(p_scope text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
      and (is_super_admin or p_scope = any (admin_scopes))
  ) and not public.is_user_banned(auth.uid());
$$;

create or replace function public.has_event_permission(p_event_id uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_permission in ('events', 'payments'), false) and (
    public.has_admin_scope(p_permission)
    or (exists (
      select 1
      from public.event_admin_assignments a
      join public.profiles p on p.id = a.profile_id
      where a.event_id = p_event_id
        and a.profile_id = auth.uid()
        and p.approval_status = 'approved'
        and p_permission = any (a.permissions)
    ) and not public.is_user_banned(auth.uid()))
  );
$$;

create or replace function public.has_any_event_permission(p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_permission in ('events', 'payments'), false) and (
    public.has_admin_scope(p_permission)
    or (exists (
      select 1
      from public.event_admin_assignments a
      join public.profiles p on p.id = a.profile_id
      where a.profile_id = auth.uid()
        and p.approval_status = 'approved'
        and p_permission = any (a.permissions)
    ) and not public.is_user_banned(auth.uid()))
  );
$$;

-- Super admin: ban (p_banned = true) or unban an account, with a reason.
-- Never deletes the account, its id, registrations, payments or uploads.
create or replace function public.super_set_user_ban(p_user_id uuid, p_banned boolean, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_target public.profiles;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN'; end if;
  if p_user_id is null or p_banned is null then raise exception 'INVALID_REQUEST'; end if;
  if char_length(v_reason) not between 1 and 300 then raise exception 'BAN_REASON_REQUIRED'; end if;
  -- Same lock order as every profile-first caller.
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;

  if p_banned then
    if p_user_id = auth.uid() then raise exception 'CANNOT_BAN_SELF'; end if;
    if v_target.role = 'admin' and v_target.is_super_admin then raise exception 'CANNOT_BAN_SUPER_ADMIN'; end if;
    if exists (select 1 from public.profile_bans where profile_id = p_user_id) then
      raise exception 'ALREADY_BANNED';
    end if;
    insert into public.profile_bans (profile_id, banned_by, reason) values (p_user_id, auth.uid(), v_reason);
    insert into public.profile_ban_events (profile_id, action, actor, reason) values (p_user_id, 'ban', auth.uid(), v_reason);
  else
    delete from public.profile_bans where profile_id = p_user_id;
    if not found then raise exception 'NOT_BANNED'; end if;
    insert into public.profile_ban_events (profile_id, action, actor, reason) values (p_user_id, 'unban', auth.uid(), v_reason);
  end if;
end $$;
revoke execute on function public.super_set_user_ban(uuid, boolean, text) from public, anon;
grant execute on function public.super_set_user_ban(uuid, boolean, text) to authenticated;

-- A banned account can't create or change participant data, through any RPC
-- (auth.uid() is the caller even inside SECURITY DEFINER functions), and
-- nobody can enrol a banned account (e.g. as a teammate). Server jobs and
-- service-role writes (auth.uid() is null) and admins acting on the account
-- are unaffected.
-- SECURITY DEFINER so a client role can't trip over helper privileges; it
-- never looks at current_user, only at auth.uid() and NEW.
create or replace function public.guard_banned_actor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_user_banned(auth.uid()) then
    raise exception 'ACCOUNT_BANNED';
  end if;
  if tg_table_name = 'registrations' and tg_op = 'INSERT' then
    -- nested: NEW.profile_id exists only on registrations
    if public.is_user_banned(new.profile_id) then
      raise exception 'MEMBER_BANNED';
    end if;
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function public.guard_banned_actor() from public, anon, authenticated;

drop trigger if exists registrations_guard_banned on public.registrations;
create trigger registrations_guard_banned before insert or update or delete on public.registrations
  for each row execute function public.guard_banned_actor();
drop trigger if exists teams_guard_banned on public.teams;
create trigger teams_guard_banned before insert or update or delete on public.teams
  for each row execute function public.guard_banned_actor();
drop trigger if exists general_registrations_guard_banned on public.general_registrations;
create trigger general_registrations_guard_banned before insert or update or delete on public.general_registrations
  for each row execute function public.guard_banned_actor();
drop trigger if exists profiles_guard_banned on public.profiles;
create trigger profiles_guard_banned before update on public.profiles
  for each row execute function public.guard_banned_actor();

-- Uploads (payment screenshots, ID cards, profile photos) by a banned account.
drop policy if exists "banned accounts cannot upload" on storage.objects;
create policy "banned accounts cannot upload" on storage.objects
  as restrictive for insert to authenticated
  with check (not public.is_user_banned(auth.uid()));
drop policy if exists "banned accounts cannot change uploads" on storage.objects;
create policy "banned accounts cannot change uploads" on storage.objects
  as restrictive for update to authenticated
  using (not public.is_user_banned(auth.uid()));

-- ── C. private Google Form link ────────────────────────────────────────────
alter table public.event_private_settings add column if not exists google_form_url text;
do $$ begin
  alter table public.event_private_settings add constraint event_private_settings_google_form_check check (
    google_form_url is null
    or (char_length(google_form_url) <= 500
        and (google_form_url ~ '^https://forms\.gle/[A-Za-z0-9_-]{6,64}$'
             or google_form_url ~ '^https://docs\.google\.com/forms/d/(e/)?[A-Za-z0-9_-]{20,128}/(viewform|formResponse)(\?[A-Za-z0-9=&_.%+-]{0,255})?$'))
  );
exception when duplicate_object then null; end $$;

create or replace function public.admin_get_event_google_form_link(p_event_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_event_permission(p_event_id, 'events') then raise exception 'FORBIDDEN'; end if;
  return (select google_form_url from public.event_private_settings where event_id = p_event_id);
end $$;
revoke execute on function public.admin_get_event_google_form_link(uuid) from public, anon;
grant execute on function public.admin_get_event_google_form_link(uuid) to authenticated;

-- Empty / null clears the link. Leaves the WhatsApp link untouched.
create or replace function public.admin_set_event_google_form_link(p_event_id uuid, p_url text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if not public.has_any_event_permission('events') then raise exception 'FORBIDDEN'; end if;
  if not public.has_event_permission(p_event_id, 'events') then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if v_url is not null and not (char_length(v_url) <= 500
      and (v_url ~ '^https://forms\.gle/[A-Za-z0-9_-]{6,64}$'
           or v_url ~ '^https://docs\.google\.com/forms/d/(e/)?[A-Za-z0-9_-]{20,128}/(viewform|formResponse)(\?[A-Za-z0-9=&_.%+-]{0,255})?$')) then
    raise exception 'INVALID_GOOGLE_FORM_LINK';
  end if;
  insert into public.event_private_settings (event_id, google_form_url, updated_by)
  values (p_event_id, v_url, auth.uid())
  on conflict (event_id) do update set
    google_form_url = excluded.google_form_url,
    updated_by = excluded.updated_by,
    updated_at = now();
end $$;
revoke execute on function public.admin_set_event_google_form_link(uuid, text) from public, anon;
grant execute on function public.admin_set_event_google_form_link(uuid, text) to authenticated;

-- ── D. public event coordinators ───────────────────────────────────────────
-- Null when valid, else a reason code. Mirrors lib/events/coordinators.ts.
create or replace function public.event_coordinators_error(p jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare
  c jsonb;
  k text;
  v text;
  has_contact boolean;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return 'NOT_ARRAY'; end if;
  if jsonb_array_length(p) > 10 then return 'TOO_MANY'; end if;
  for c in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(c) <> 'object' then return 'NOT_OBJECT'; end if;
    for k in select jsonb_object_keys(c) loop
      if k not in ('name', 'role', 'phone', 'email') then return 'UNKNOWN_KEY'; end if;
      if jsonb_typeof(c -> k) <> 'string' then return 'NOT_STRING'; end if;
      v := c ->> k;
      if v <> btrim(v) or v = '' or v ~ '[[:cntrl:]]' then return 'UNTRIMMED_OR_EMPTY'; end if;
    end loop;
    if not c ? 'name' or char_length(c ->> 'name') > 80 then return 'INVALID_NAME'; end if;
    if c ? 'role' and char_length(c ->> 'role') > 80 then return 'INVALID_ROLE'; end if;
    if c ? 'phone' and (c ->> 'phone') !~ '^\+?[0-9][0-9 -]{5,18}[0-9]$' then return 'INVALID_PHONE'; end if;
    if c ? 'email' and (char_length(c ->> 'email') > 254
        or (c ->> 'email') !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$') then
      return 'INVALID_EMAIL';
    end if;
    has_contact := c ? 'phone' or c ? 'email';
    if not has_contact then return 'CONTACT_REQUIRED'; end if;
  end loop;
  return null;
end $$;

alter table public.events add column if not exists coordinators jsonb not null default '[]'::jsonb;
do $$ begin
  alter table public.events add constraint events_coordinators_valid
    check (public.event_coordinators_error(coordinators) is null);
exception when duplicate_object then null; end $$;

-- Events permission (global or on this event): replace the coordinator list.
create or replace function public.admin_set_event_coordinators(p_event_id uuid, p_coordinators jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_err text;
begin
  if not public.has_any_event_permission('events') then raise exception 'FORBIDDEN'; end if;
  if not public.has_event_permission(p_event_id, 'events') then raise exception 'FORBIDDEN'; end if;
  v_err := public.event_coordinators_error(coalesce(p_coordinators, '[]'::jsonb));
  if v_err is not null then raise exception 'INVALID_COORDINATORS' using detail = v_err; end if;
  update public.events set coordinators = coalesce(p_coordinators, '[]'::jsonb) where id = p_event_id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
end $$;
revoke execute on function public.admin_set_event_coordinators(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_event_coordinators(uuid, jsonb) to authenticated;
