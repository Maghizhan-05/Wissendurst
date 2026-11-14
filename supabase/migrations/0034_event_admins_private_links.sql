-- ============================================================================
-- WISSENDURST'27 — 0034_event_admins_private_links
--
-- Pre-analytics restructuring, phase 3 (D-021 / D-022, approved).
--   (1) Additive per-event administrators. A super admin assigns an approved
--       account to one event with the `events` and/or `payments` permission.
--       Authorization resolves as: super admin, OR the matching GLOBAL area
--       scope (unchanged — every existing global admin keeps site-wide reach),
--       OR a matching event assignment. Assignments never change a profile's
--       role, scopes or participant ID.
--         events   → view that event's confirmed registrations and contact
--                    details; edit its descriptive details and private
--                    WhatsApp link (event_admin_update_event_details,
--                    admin_set_event_whatsapp_link).
--         payments → review/verify that event's payments
--                    (admin_set_payment_status now accepts it).
--   (2) A private, optional WhatsApp group link per event, stored OUTSIDE the
--       publicly readable `events` row. Clients can't read the table at all;
--       admins read/write it through permission-checked RPCs and the server
--       (service role) reads it only to put it in successful-registration
--       emails.
-- No existing row, policy or global scope changes. Safe to re-run.
-- ============================================================================

-- ── (1) event administrator assignments ─────────────────────────────────────
create table if not exists public.event_admin_assignments (
  event_id    uuid not null references public.events(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  permissions text[] not null,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (event_id, profile_id),
  constraint event_admin_assignments_permissions_check check (
    cardinality(permissions) between 1 and 2
    and permissions <@ array['events', 'payments']::text[]
  )
);
create index if not exists event_admin_assignments_profile_idx
  on public.event_admin_assignments (profile_id);

alter table public.event_admin_assignments enable row level security;
revoke all on public.event_admin_assignments from public, anon, authenticated;
grant select on public.event_admin_assignments to authenticated;
grant all on public.event_admin_assignments to service_role;
-- An account sees its own assignments; the super admin sees all of them.
-- Writes only through super_set_event_admin.
drop policy if exists event_admin_assignments_read on public.event_admin_assignments;
create policy event_admin_assignments_read on public.event_admin_assignments
  for select using (profile_id = auth.uid() or public.is_super_admin());

-- Super admin, matching global scope, or matching assignment of an approved
-- account. Only the two event-scoped areas exist.
create or replace function public.has_event_permission(p_event_id uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_permission in ('events', 'payments'), false) and (
    public.has_admin_scope(p_permission)
    or exists (
      select 1
      from public.event_admin_assignments a
      join public.profiles p on p.id = a.profile_id
      where a.event_id = p_event_id
        and a.profile_id = auth.uid()
        and p.approval_status = 'approved'
        and p_permission = any (a.permissions)
    )
  );
$$;
revoke execute on function public.has_event_permission(uuid, text) from public, anon;
grant execute on function public.has_event_permission(uuid, text) to authenticated;

-- Whether the caller holds the permission on ANY event (global scope counts).
-- Used to refuse before revealing whether a given row exists.
create or replace function public.has_any_event_permission(p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_permission in ('events', 'payments'), false) and (
    public.has_admin_scope(p_permission)
    or exists (
      select 1
      from public.event_admin_assignments a
      join public.profiles p on p.id = a.profile_id
      where a.profile_id = auth.uid()
        and p.approval_status = 'approved'
        and p_permission = any (a.permissions)
    )
  );
$$;
revoke execute on function public.has_any_event_permission(text) from public, anon;
grant execute on function public.has_any_event_permission(text) to authenticated;

-- Super admin: set (or with an empty list, remove) one account's permissions
-- on one event. Broader events (with sub-events) take no registrations, so
-- assignments target the event people actually register for.
create or replace function public.super_set_event_admin(
  p_user_id uuid,
  p_event_id uuid,
  p_permissions text[]
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_perms text[];
  v_status approval_status;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN'; end if;
  if p_user_id is null or p_event_id is null then raise exception 'INVALID_EVENT_ADMIN'; end if;
  if exists (select 1 from unnest(coalesce(p_permissions, '{}')) x
             where x is null or x not in ('events', 'payments')) then
    raise exception 'INVALID_EVENT_PERMISSION';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_perms
  from unnest(coalesce(p_permissions, '{}')) x;

  if cardinality(v_perms) = 0 then
    delete from public.event_admin_assignments
    where event_id = p_event_id and profile_id = p_user_id;
    return;
  end if;

  select approval_status into v_status from public.profiles where id = p_user_id;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_status <> 'approved' then raise exception 'USER_NOT_APPROVED'; end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if exists (select 1 from public.events where parent_event_id = p_event_id) then
    raise exception 'EVENT_IS_BROADER';
  end if;

  insert into public.event_admin_assignments (event_id, profile_id, permissions, assigned_by)
  values (p_event_id, p_user_id, v_perms, auth.uid())
  on conflict (event_id, profile_id) do update set
    permissions = excluded.permissions,
    assigned_by = excluded.assigned_by,
    updated_at = now();
end $$;
revoke execute on function public.super_set_event_admin(uuid, uuid, text[]) from public, anon;
grant execute on function public.super_set_event_admin(uuid, uuid, text[]) to authenticated;

-- Event admins (events permission) edit only the descriptive details of their
-- event. Title, slug, category, fees, capacity, hierarchy, offers, flags and
-- images stay with global events admins (who keep their direct path).
create or replace function public.event_admin_update_event_details(
  p_event_id uuid,
  p_short_description text,
  p_description text,
  p_eligibility text,
  p_venue text,
  p_event_date date,
  p_start_time time,
  p_end_time time,
  p_rules jsonb
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_short text := btrim(coalesce(p_short_description, ''));
  v_desc text := btrim(coalesce(p_description, ''));
  v_elig text := nullif(btrim(coalesce(p_eligibility, '')), '');
  v_venue text := nullif(btrim(coalesce(p_venue, '')), '');
  v_rules jsonb := coalesce(p_rules, '[]'::jsonb);
begin
  if not public.has_any_event_permission('events') then raise exception 'FORBIDDEN'; end if;
  if not public.has_event_permission(p_event_id, 'events') then raise exception 'FORBIDDEN'; end if;
  if char_length(v_short) not between 5 and 180
     or char_length(v_desc) > 5000
     or char_length(coalesce(v_elig, '')) > 300
     or char_length(coalesce(v_venue, '')) > 160 then
    raise exception 'INVALID_EVENT_DETAILS';
  end if;
  if jsonb_typeof(v_rules) <> 'array' or jsonb_array_length(v_rules) > 100
     or exists (select 1 from jsonb_array_elements(v_rules) r
                where jsonb_typeof(r) <> 'string'
                   or btrim(r #>> '{}') = ''
                   or char_length(r #>> '{}') > 2000) then
    raise exception 'INVALID_EVENT_RULES';
  end if;

  update public.events set
    short_description = v_short,
    description = v_desc,
    eligibility = v_elig,
    venue = v_venue,
    event_date = p_event_date,
    start_time = p_start_time,
    end_time = p_end_time,
    rules = v_rules
  where id = p_event_id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
end $$;
revoke execute on function public.event_admin_update_event_details(uuid, text, text, text, text, date, time, time, jsonb) from public, anon;
grant execute on function public.event_admin_update_event_details(uuid, text, text, text, text, date, time, time, jsonb) to authenticated;

-- ── (2) private event settings: WhatsApp group link ─────────────────────────
create table if not exists public.event_private_settings (
  event_id           uuid primary key references public.events(id) on delete cascade,
  whatsapp_group_url text,
  updated_by         uuid references public.profiles(id) on delete set null,
  updated_at         timestamptz not null default now(),
  constraint event_private_settings_whatsapp_check check (
    whatsapp_group_url is null
    or (char_length(whatsapp_group_url) <= 200
        and whatsapp_group_url ~ '^https://chat\.whatsapp\.com/[A-Za-z0-9]{10,64}(\?[A-Za-z0-9=&_.-]{0,100})?$')
  )
);
alter table public.event_private_settings enable row level security;
-- No client role may read or write it; only the RPCs below and the server.
revoke all on public.event_private_settings from public, anon, authenticated;
grant all on public.event_private_settings to service_role;

create or replace function public.admin_get_event_whatsapp_link(p_event_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_event_permission(p_event_id, 'events') then raise exception 'FORBIDDEN'; end if;
  return (select whatsapp_group_url from public.event_private_settings where event_id = p_event_id);
end $$;
revoke execute on function public.admin_get_event_whatsapp_link(uuid) from public, anon;
grant execute on function public.admin_get_event_whatsapp_link(uuid) to authenticated;

-- Empty / null clears the link.
create or replace function public.admin_set_event_whatsapp_link(p_event_id uuid, p_url text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if not public.has_any_event_permission('events') then raise exception 'FORBIDDEN'; end if;
  if not public.has_event_permission(p_event_id, 'events') then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if v_url is not null and (char_length(v_url) > 200
      or v_url !~ '^https://chat\.whatsapp\.com/[A-Za-z0-9]{10,64}(\?[A-Za-z0-9=&_.-]{0,100})?$') then
    raise exception 'INVALID_WHATSAPP_LINK';
  end if;
  insert into public.event_private_settings (event_id, whatsapp_group_url, updated_by)
  values (p_event_id, v_url, auth.uid())
  on conflict (event_id) do update set
    whatsapp_group_url = excluded.whatsapp_group_url,
    updated_by = excluded.updated_by,
    updated_at = now();
end $$;
revoke execute on function public.admin_set_event_whatsapp_link(uuid, text) from public, anon;
grant execute on function public.admin_set_event_whatsapp_link(uuid, text) to authenticated;

-- ── (3) payment review: global payments scope OR this event's assignment ────
-- Re-shipped from 0031 with only the authorization changed: refuse callers
-- without any payments permission before looking the row up, then require the
-- permission on the registration's own event.
create or replace function public.admin_set_payment_status(p_registration_id uuid, p_status payment_status, p_note text DEFAULT NULL::text)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_reg public.registrations;
  v_event public.events;
  v_from payment_status;
  v_before int;
  v_after int;
begin
  -- 0034: global payments scope or a payments assignment on this event.
  if not public.has_any_event_permission('payments') then raise exception 'FORBIDDEN'; end if;
  select * into v_reg from public.registrations where id = p_registration_id;
  if not found then raise exception 'REGISTRATION_NOT_FOUND'; end if;
  if not public.has_event_permission(v_reg.event_id, 'payments') then raise exception 'FORBIDDEN'; end if;
  -- Same lock as register_for_event / register_team / submit_payment.
  perform pg_advisory_xact_lock(hashtext(v_reg.event_id::text));
  -- Lock and reload the row and its team (state may have changed meanwhile).
  select * into v_reg from public.registrations
  where id = p_registration_id for update;
  if v_reg.team_id is not null then
    perform 1 from public.registrations
    where team_id = v_reg.team_id for update;
  end if;
  select * into v_event from public.events where id = v_reg.event_id;
  v_from := v_reg.payment_status;
  v_before := public.event_seats_taken(v_reg.event_id);

  -- 0031: a rejection keeps the evidence it rejected (append-only).
  if p_status = 'rejected' and v_from <> 'rejected' then
    insert into public.payment_rejections (registration_id, transaction_id, payment_screenshot, amount, note, rejected_by)
    values (v_reg.id, v_reg.transaction_id, v_reg.payment_screenshot, v_reg.amount,
            nullif(btrim(coalesce(p_note, '')), ''), v_uid);
  end if;

  -- The row and (for a team) every teammate get the same outcome.
  update public.registrations set
    payment_status = p_status,
    registration_status = case
      when p_status = 'verified' then 'confirmed'::registration_status
      when p_status = 'rejected' then 'rejected'::registration_status
      when registration_status = 'cancelled' then 'cancelled'::registration_status
      else 'pending'::registration_status end,
    -- Re-verifying an already verified row keeps the original verifier/time.
    verified_at = case
      when p_status = 'verified' and payment_status = 'verified' then verified_at
      when p_status = 'verified' then now()
      else verified_at end,
    verified_by = case
      when p_status = 'verified' and payment_status = 'verified' then verified_by
      when p_status = 'verified' then v_uid
      else verified_by end,
    hold_expires_at = case
      when p_status in ('unpaid', 'uploaded', 'duplicate') then now() + interval '72 hours'
      else null end
  where id = p_registration_id
     or (v_reg.team_id is not null and team_id = v_reg.team_id);
  -- Capacity: the change may not take seats the event doesn't have.
  if v_event.max_participants is not null then
    v_after := public.event_seats_taken(v_reg.event_id);
    if v_after > v_before and v_after > v_event.max_participants then
      if p_status = 'verified' then
        raise exception 'EVENT_FULL_AT_VERIFICATION'
          using detail = format('needs %s more seat(s); %s of %s already taken',
                                v_after - v_before, v_before, v_event.max_participants);
      else
        raise exception 'EVENT_FULL_AT_REVIEW'
          using detail = format('needs %s more seat(s); %s of %s already taken',
                                v_after - v_before, v_before, v_event.max_participants);
      end if;
    end if;
  end if;
  select * into v_reg from public.registrations where id = p_registration_id;
  insert into public.payment_events(registration_id, actor_id, action, from_status, to_status, note)
  values (p_registration_id, v_uid, 'admin_review', v_from, p_status, p_note);
  return v_reg;
end $$;
revoke execute on function public.admin_set_payment_status(uuid, payment_status, text) from public, anon;
grant execute on function public.admin_set_payment_status(uuid, payment_status, text) to authenticated;
