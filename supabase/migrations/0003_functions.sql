-- ============================================================================
-- WISSENDURST'27 — 0003_functions
-- SECURITY DEFINER RPCs that centralise the rules RLS cannot express safely:
-- capacity-checked registration, duplicate-aware payment submission, and
-- admin-only payment state transitions.
-- ============================================================================

-- ── register_for_event ──────────────────────────────────────────────────────
create or replace function public.register_for_event(p_event_id uuid)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_event public.events;
  v_count int;
  v_reg public.registrations;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- Serialize capacity checks per-event to avoid oversell races.
  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if not v_event.registration_open then
    raise exception 'REGISTRATION_CLOSED';
  end if;

  if exists (
    select 1 from public.registrations
    where profile_id = v_uid and event_id = p_event_id
      and registration_status <> 'cancelled'
  ) then
    raise exception 'ALREADY_REGISTERED';
  end if;

  if v_event.max_participants is not null then
    select count(*) into v_count from public.registrations
    where event_id = p_event_id and registration_status in ('pending','confirmed');
    if v_count >= v_event.max_participants then
      raise exception 'EVENT_FULL';
    end if;
  end if;

  insert into public.registrations (
    profile_id, event_id, amount,
    registration_status, payment_status
  ) values (
    v_uid, p_event_id, v_event.registration_fee,
    case when v_event.registration_fee = 0 then 'confirmed' else 'pending' end,
    case when v_event.registration_fee = 0 then 'verified'  else 'unpaid'  end
  )
  on conflict (profile_id, event_id) do update
    set registration_status = case
          when v_event.registration_fee = 0 then 'confirmed'
          else 'pending' end,
        payment_status = case
          when v_event.registration_fee = 0 then 'verified'
          else 'unpaid' end
    where public.registrations.registration_status = 'cancelled'
  returning * into v_reg;

  return v_reg;
end $$;

-- ── submit_payment ──────────────────────────────────────────────────────────
-- Attaches a payment screenshot + (optional) transaction id to the caller's
-- own registration, detecting duplicates against ALL registrations.
create or replace function public.submit_payment(
  p_registration_id uuid,
  p_transaction_id  text,
  p_screenshot      text,
  p_ocr_raw         text default null,
  p_ocr_conf        numeric default null
)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_reg public.registrations;
  v_txn text;
  v_existing uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_reg from public.registrations where id = p_registration_id;
  if not found then raise exception 'REGISTRATION_NOT_FOUND'; end if;
  if v_reg.profile_id <> v_uid then raise exception 'FORBIDDEN'; end if;

  v_txn := nullif(upper(trim(coalesce(p_transaction_id, ''))), '');

  -- No usable transaction id yet: just store the screenshot for review.
  if v_txn is null then
    update public.registrations set
      payment_screenshot = coalesce(p_screenshot, payment_screenshot),
      ocr_raw_text = coalesce(p_ocr_raw, ocr_raw_text),
      ocr_confidence = coalesce(p_ocr_conf, ocr_confidence),
      payment_status = 'uploaded',
      transaction_id = null,
      duplicate_of = null
    where id = p_registration_id
    returning * into v_reg;

    insert into public.payment_events(registration_id, actor_id, action, to_status, note)
    values (p_registration_id, v_uid, 'screenshot_uploaded', 'uploaded',
            'No transaction id extracted');
    return v_reg;
  end if;

  -- Does this transaction id already belong to a DIFFERENT registration?
  select id into v_existing from public.registrations
  where transaction_id = v_txn and id <> p_registration_id
  limit 1;

  if v_existing is not null then
    update public.registrations set
      payment_screenshot = coalesce(p_screenshot, payment_screenshot),
      ocr_raw_text = coalesce(p_ocr_raw, ocr_raw_text),
      ocr_confidence = coalesce(p_ocr_conf, ocr_confidence),
      payment_status = 'duplicate',
      duplicate_of = v_existing,
      transaction_id = null
    where id = p_registration_id
    returning * into v_reg;

    insert into public.payment_events(registration_id, actor_id, action, to_status, note)
    values (p_registration_id, v_uid, 'duplicate_detected', 'duplicate',
            'Transaction id already used by registration ' || v_existing::text);
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
      payment_status = 'under_review'
    where id = p_registration_id
    returning * into v_reg;
  exception when unique_violation then
    -- Lost a race: another registration grabbed this txn first.
    update public.registrations set
      payment_screenshot = coalesce(p_screenshot, payment_screenshot),
      ocr_raw_text = coalesce(p_ocr_raw, ocr_raw_text),
      ocr_confidence = coalesce(p_ocr_conf, ocr_confidence),
      payment_status = 'duplicate',
      transaction_id = null
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

-- ── admin_set_payment_status ────────────────────────────────────────────────
create or replace function public.admin_set_payment_status(
  p_registration_id uuid,
  p_status          payment_status,
  p_note            text default null
)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_reg public.registrations;
  v_from payment_status;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  select * into v_reg from public.registrations where id = p_registration_id;
  if not found then raise exception 'REGISTRATION_NOT_FOUND'; end if;
  v_from := v_reg.payment_status;

  update public.registrations set
    payment_status = p_status,
    registration_status = case
      when p_status = 'verified' then 'confirmed'::registration_status
      when p_status = 'rejected' then 'rejected'::registration_status
      else registration_status end,
    verified_at = case when p_status = 'verified' then now() else verified_at end,
    verified_by = case when p_status = 'verified' then v_uid else verified_by end
  where id = p_registration_id
  returning * into v_reg;

  insert into public.payment_events(registration_id, actor_id, action, from_status, to_status, note)
  values (p_registration_id, v_uid, 'admin_review', v_from, p_status, p_note);

  return v_reg;
end $$;

-- ── cancel_registration ─────────────────────────────────────────────────────
-- Lets a user cancel their OWN registration, but only while unpaid/uploaded so
-- they cannot undo a verified payment. Only ever flips the status.
create or replace function public.cancel_registration(p_registration_id uuid)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_reg public.registrations;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_reg from public.registrations where id = p_registration_id;
  if not found then raise exception 'REGISTRATION_NOT_FOUND'; end if;
  if v_reg.profile_id <> v_uid then raise exception 'FORBIDDEN'; end if;
  if v_reg.payment_status not in ('unpaid','uploaded') then
    raise exception 'CANNOT_CANCEL';
  end if;

  update public.registrations
    set registration_status = 'cancelled'
  where id = p_registration_id
  returning * into v_reg;
  return v_reg;
end $$;

grant execute on function public.register_for_event(uuid) to authenticated;
grant execute on function public.cancel_registration(uuid) to authenticated;
grant execute on function public.submit_payment(uuid, text, text, text, numeric) to authenticated;
grant execute on function public.admin_set_payment_status(uuid, payment_status, text) to authenticated;
