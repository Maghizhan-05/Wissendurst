-- ============================================================================
-- WISSENDURST'27 — 0031_signup_resubmission_payment_retry
--
-- Phase 10 follow-up (approved D-019).
--   A. Sign-up approval transitions are explicit and audited:
--        pending → approved | rejected   (admin, signups scope)
--        rejected → pending              (the applicant, by resubmitting)
--      Anything else is refused (INVALID_APPROVAL_TRANSITION) — so rejection
--      can never revoke an approved participant. Rejecting releases any E id
--      the applicant holds through the existing allocator (0021), which
--      re-issues the lowest free number on a later approval.
--      profile_approval_events is the append-only transition history.
--   B. resubmit_my_application: the SAME account corrects its details and
--      uploads a replacement college ID card, returning to pending (no id).
--   C. Rejected payments keep their evidence: payment_rejections records the
--      screenshot/UTR/note of every rejection (append-only). A retry must use
--      a UTR that wasn't already rejected for that registration.
--   D. site_settings.schedule — Schedule page wording (validated in the app,
--      object-typed here).
-- Safe to re-run.
-- ============================================================================

-- ── A. approval history + transitions ──────────────────────────────────────
create table if not exists public.profile_approval_events (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  from_status approval_status not null,
  to_status   approval_status not null,
  actor       uuid references public.profiles(id) on delete set null,
  reason      text check (reason is null or char_length(reason) <= 300),
  created_at  timestamptz not null default now()
);
create index if not exists profile_approval_events_profile_idx
  on public.profile_approval_events (profile_id, created_at);
alter table public.profile_approval_events enable row level security;
revoke all on public.profile_approval_events from public, anon, authenticated;
grant select on public.profile_approval_events to authenticated;
drop policy if exists profile_approval_events_read on public.profile_approval_events;
create policy profile_approval_events_read on public.profile_approval_events
  for select using (profile_id = auth.uid() or public.has_admin_scope('signups'));

create or replace function public.guard_append_only()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'APPEND_ONLY' using detail = tg_table_name;
end $$;
drop trigger if exists profile_approval_events_append_only on public.profile_approval_events;
create trigger profile_approval_events_append_only
  before update or delete on public.profile_approval_events
  for each row execute function public.guard_append_only();

-- Same signature as 0021 (older test suites re-create it; no overloads).
create or replace function public.admin_set_approval(p_user_id uuid, p_status approval_status)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_row public.profiles;
  v_ns text;
begin
  if not public.has_admin_scope('signups') then raise exception 'FORBIDDEN'; end if;
  if p_user_id is null or p_status is null then raise exception 'INVALID_REQUEST'; end if;

  -- Lock order: profile row, then (inside the allocator) namespace rows.
  select * into v_row from public.profiles where id = p_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;

  if v_row.approval_status = p_status then
    return v_row;                                          -- idempotent: no history
  end if;
  if not (v_row.approval_status = 'pending' and p_status in ('approved', 'rejected')) then
    raise exception 'INVALID_APPROVAL_TRANSITION'
      using detail = v_row.approval_status::text || ' -> ' || p_status::text;
  end if;
  if p_status = 'rejected' and v_row.role = 'admin' then
    raise exception 'INVALID_APPROVAL_TRANSITION' using detail = 'staff accounts are not sign-up applications';
  end if;

  update public.profiles set
    approval_status = p_status,
    approved_by = auth.uid(),
    approved_at = case when p_status = 'approved' then now() else null end
  where id = p_user_id;

  if p_status = 'approved' then
    -- First approval mints an id; a profile that already holds one keeps it.
    if not exists (select 1 from public.participant_id_allocations where profile_id = p_user_id) then
      perform public.participant_id_sync_role(p_user_id, auth.uid(), 'approval');
    end if;
  else
    -- A rejected applicant holds no participant id; any E id goes back to the
    -- pool (the allocator records the release in participant_id_history).
    select namespace into v_ns from public.participant_id_allocations where profile_id = p_user_id;
    if v_ns = 'E' then
      perform public.participant_id_release(p_user_id, 'E', auth.uid(), 'sign-up rejected');
    end if;
  end if;

  insert into public.profile_approval_events (profile_id, from_status, to_status, actor, reason)
  values (p_user_id, v_row.approval_status, p_status, auth.uid(), null);

  select * into v_row from public.profiles where id = p_user_id;
  return v_row;
end $$;
revoke execute on function public.admin_set_approval(uuid, approval_status) from public, anon;
grant execute on function public.admin_set_approval(uuid, approval_status) to authenticated;

-- ── B. same-account resubmission ───────────────────────────────────────────
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
  if v_row.approval_status <> 'rejected' then raise exception 'APPLICATION_NOT_REJECTED'; end if;

  -- Same limits as lib/validation/auth.ts profileSchema / update_my_profile.
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
    id_card_path = v_path,
    approval_status = 'pending',
    approved_by = null,
    approved_at = null
  where id = v_uid
  returning * into v_row;

  insert into public.profile_approval_events (profile_id, from_status, to_status, actor, reason)
  values (v_uid, 'rejected', 'pending', v_uid, 'resubmitted');
  return v_row;
end $$;
revoke execute on function public.resubmit_my_application(text, text, text, text, text, text) from public, anon;
grant execute on function public.resubmit_my_application(text, text, text, text, text, text) to authenticated;

-- Existing rejected applicants holding an E id (none live at authoring time)
-- release it now, so every rejected applicant is id-less.
do $$
declare r record;
begin
  for r in
    select p.id from public.profiles p
    join public.participant_id_allocations a on a.profile_id = p.id and a.namespace = 'E'
    where p.approval_status = 'rejected' and p.role = 'user'
    order by p.id
  loop
    perform public.participant_id_release(r.id, 'E', null, 'sign-up rejected (0031 backfill)');
  end loop;
end $$;

-- ── C. rejected-payment evidence + retry ───────────────────────────────────
create table if not exists public.payment_rejections (
  id                 bigint generated always as identity primary key,
  registration_id    uuid not null references public.registrations(id) on delete cascade,
  transaction_id     text,
  payment_screenshot text,
  amount             integer not null,
  note               text,
  rejected_by        uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists payment_rejections_registration_idx
  on public.payment_rejections (registration_id, created_at);
alter table public.payment_rejections enable row level security;
revoke all on public.payment_rejections from public, anon, authenticated;
grant select on public.payment_rejections to authenticated;
drop policy if exists payment_rejections_read on public.payment_rejections;
create policy payment_rejections_read on public.payment_rejections
  for select using (
    public.has_admin_scope('payments')
    or exists (select 1 from public.registrations r where r.id = registration_id and r.profile_id = auth.uid())
  );
drop trigger if exists payment_rejections_append_only on public.payment_rejections;
create trigger payment_rejections_append_only
  before update on public.payment_rejections
  for each row execute function public.guard_append_only();

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
  if not public.has_admin_scope('payments') then raise exception 'FORBIDDEN'; end if;
  select * into v_reg from public.registrations where id = p_registration_id;
  if not found then raise exception 'REGISTRATION_NOT_FOUND'; end if;
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

-- submit_payment: as 0026, plus the rejected-UTR rule.
create or replace function public.submit_payment(p_registration_id uuid, p_transaction_id text, p_screenshot text, p_ocr_raw text DEFAULT NULL::text, p_ocr_conf numeric DEFAULT NULL::numeric)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_reg public.registrations;
  v_event public.events;
  v_txn text;
  v_existing uuid;
  v_existing_gr uuid;
  v_claimed boolean;
  v_needed int;
  v_new_window boolean;
  v_new_hold timestamptz;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_reg from public.registrations where id = p_registration_id;
  if not found then raise exception 'REGISTRATION_NOT_FOUND'; end if;
  if v_reg.profile_id <> v_uid then raise exception 'FORBIDDEN'; end if;
  if v_reg.team_id is not null and not v_reg.is_team_head then
    raise exception 'TEAM_HEAD_PAYS';
  end if;

  -- Serialise with registration/capacity changes on this event.
  perform pg_advisory_xact_lock(hashtext(v_reg.event_id::text));
  select * into v_reg from public.registrations where id = p_registration_id for update;
  select * into v_event from public.events where id = v_reg.event_id;

  if v_event.archived_at is not null then
    raise exception 'EVENT_ARCHIVED';
  end if;
  -- Covered events are paid through General Registration, never individually.
  if v_event.general_registration_covered then
    raise exception 'GENERAL_REGISTRATION_REQUIRED';
  end if;
  if v_reg.registration_status = 'cancelled' then
    raise exception 'REGISTRATION_CANCELLED';
  end if;
  if v_reg.registration_status = 'confirmed' or v_reg.payment_status = 'verified' then
    raise exception 'ALREADY_PAID';
  end if;
  if public.reg_state_expired(v_reg.registration_status, v_reg.payment_status, v_reg.hold_expires_at) then
    raise exception 'HOLD_EXPIRED';
  end if;

  v_txn := nullif(upper(trim(coalesce(p_transaction_id, ''))), '');
  -- 0031: a retry can't re-submit a transaction id that was already rejected.
  if v_txn is not null and exists (
    select 1 from public.payment_rejections pr
    where pr.registration_id = p_registration_id and pr.transaction_id = v_txn
  ) then
    raise exception 'UTR_PREVIOUSLY_REJECTED';
  end if;

  -- A rejected payment holds no seat: re-submitting must win a seat again.
  if v_reg.registration_status = 'rejected' then
    if v_reg.team_id is not null then
      select count(*) into v_needed from public.registrations
      where team_id = v_reg.team_id and registration_status <> 'cancelled';
    else
      v_needed := 1;
    end if;
    if v_event.max_participants is not null
       and public.event_seats_taken(v_reg.event_id) + v_needed > v_event.max_participants then
      raise exception 'EVENT_FULL';
    end if;
    update public.registrations
       set registration_status = 'pending'
     where (id = v_reg.id
            or (v_reg.team_id is not null and team_id = v_reg.team_id))
       and registration_status = 'rejected';
    v_new_window := true;
  else
    -- Correcting a submission that was under review opens one fresh window.
    v_new_window := v_reg.payment_status = 'under_review';
  end if;
  v_new_hold := case when v_new_window then now() + interval '72 hours'
                     else v_reg.hold_expires_at end;

  -- No usable transaction id yet: just store the screenshot for review.
  if v_txn is null then
    update public.registrations set
      payment_screenshot = coalesce(p_screenshot, payment_screenshot),
      ocr_raw_text = coalesce(p_ocr_raw, ocr_raw_text),
      ocr_confidence = coalesce(p_ocr_conf, ocr_confidence),
      payment_status = 'uploaded',
      transaction_id = null,
      duplicate_of = null,
      hold_expires_at = v_new_hold
    where id = p_registration_id
    returning * into v_reg;

    insert into public.payment_events(registration_id, actor_id, action, to_status, note)
    values (p_registration_id, v_uid, 'screenshot_uploaded', 'uploaded',
            'No transaction id extracted');
    return v_reg;
  end if;

  -- Is this transaction id already claimed by a DIFFERENT payment — another
  -- registration or a General Registration (global claim table, 0023)?
  select c.registration_id, c.general_registration_id, true
    into v_existing, v_existing_gr, v_claimed
  from public.payment_utr_claims c
  where c.utr = v_txn and c.registration_id is distinct from p_registration_id;

  if coalesce(v_claimed, false) then
    update public.registrations set
      payment_screenshot = coalesce(p_screenshot, payment_screenshot),
      ocr_raw_text = coalesce(p_ocr_raw, ocr_raw_text),
      ocr_confidence = coalesce(p_ocr_conf, ocr_confidence),
      payment_status = 'duplicate',
      duplicate_of = v_existing,
      transaction_id = null,
      hold_expires_at = v_new_hold
    where id = p_registration_id
    returning * into v_reg;

    insert into public.payment_events(registration_id, actor_id, action, to_status, note)
    values (p_registration_id, v_uid, 'duplicate_detected', 'duplicate',
            case when v_existing is not null
                 then 'Transaction id already used by registration ' || v_existing::text
                 else 'Transaction id already used by general registration ' || v_existing_gr::text end);
    return v_reg;
  end if;

  -- Unique path. The partial unique index is the hard guarantee against races.
  begin
    update public.registrations set
      payment_screenshot = coalesce(p_screenshot, payment_screenshot),
      ocr_raw_text = coalesce(p_ocr_raw, ocr_raw_text),
      ocr_confidence = coalesce(p_ocr_conf, ocr_confidence),
      transaction_id = v_txn,
      duplicate_of = null,
      payment_status = 'under_review',
      hold_expires_at = v_new_hold
    where id = p_registration_id
    returning * into v_reg;
  exception when unique_violation then
    update public.registrations set
      payment_screenshot = coalesce(p_screenshot, payment_screenshot),
      ocr_raw_text = coalesce(p_ocr_raw, ocr_raw_text),
      ocr_confidence = coalesce(p_ocr_conf, ocr_confidence),
      payment_status = 'duplicate',
      transaction_id = null,
      hold_expires_at = v_new_hold
    where id = p_registration_id
    returning * into v_reg;

    insert into public.payment_events(registration_id, actor_id, action, to_status, note)
    values (p_registration_id, v_uid, 'duplicate_detected', 'duplicate',
            'Transaction id race lost');
    return v_reg;
  end;

  insert into public.payment_events(registration_id, actor_id, action, to_status, note)
  values (p_registration_id, v_uid, 'payment_submitted', 'under_review', null);
  return v_reg;
end $$;

-- ── D. Schedule page wording ───────────────────────────────────────────────
alter table public.site_settings add column if not exists schedule jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'site_settings_schedule_object') then
    alter table public.site_settings add constraint site_settings_schedule_object
      check (jsonb_typeof(schedule) = 'object' and pg_column_size(schedule) <= 16384);
  end if;
end $$;
