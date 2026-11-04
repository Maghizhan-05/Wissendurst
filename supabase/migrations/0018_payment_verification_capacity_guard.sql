-- ============================================================================
-- WISSENDURST'27 — 0018_payment_verification_capacity_guard
-- Corrective follow-up to 0017: admin payment review must respect capacity.
--
-- admin_set_payment_status now
--   1. takes the per-event advisory lock used by registration/submission,
--   2. locks and reloads the registration and its whole team,
--   3. applies the (unchanged) outcome + team cascade, then
--   4. if the change made the event take MORE seats than before and the event
--      is now over capacity, raises EVENT_FULL_AT_VERIFICATION (verification)
--      or EVENT_FULL_AT_REVIEW (re-opening a rejected/expired payment). The
--      exception aborts the call, so no row is changed.
-- Consequences:
--   * An intent that still holds its seat (live 72 h hold or under review)
--     verifies without needing capacity; re-verifying is idempotent.
--   * An expired/rejected individual intent must re-acquire one seat; a team
--     must re-acquire its complete size, atomically.
--   * Archived events can still be resolved (no archive check here).
-- Forward-only and safe to re-run.
-- ============================================================================

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

grant execute on function public.admin_set_payment_status(uuid, payment_status, text) to authenticated;
