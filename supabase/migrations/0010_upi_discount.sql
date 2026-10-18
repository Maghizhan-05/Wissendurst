-- ============================================================================
-- WISSENDRUST'27 — 0010_upi_discount
-- 1. Per-event UPI id (shown as the payment QR). Resolved leaf-first: a
--    registerable event uses its own upi_id, else the nearest ancestor's,
--    else the env default. Set it at any level (event / sub / sub-sub).
-- 2. Sibling discount on a broader (top-level) event: discount_enabled +
--    discount_amount (paise). Once a user has a VERIFIED payment on one
--    sub-event under a broader event, a new registration for another
--    sub-event under the same broader event gets the discount applied.
-- The sub-event tree (0009) already allows three levels; this only adds the
-- columns and the discount logic to register_for_event.
-- ============================================================================

alter table public.events
  add column if not exists upi_id text,
  add column if not exists discount_enabled boolean not null default false,
  add column if not exists discount_amount integer not null default 0; -- paise

create or replace function public.register_for_event(p_event_id uuid)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_event public.events;
  v_count int;
  v_reg public.registrations;
  v_root_id uuid;
  v_disc_en boolean := false;
  v_disc_amt int := 0;
  v_amount int;
  v_eligible boolean := false;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  -- A broader event (one that has sub-events) isn't registered for directly.
  if exists (select 1 from public.events where parent_event_id = p_event_id) then
    raise exception 'HAS_SUBEVENTS';
  end if;
  if not v_event.is_live then
    raise exception 'NOT_LIVE';
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

  v_amount := v_event.registration_fee;

  -- Sibling discount: reward a paid sub-event with a discount on other
  -- sub-events under the same broader (top-level) event.
  if v_amount > 0 then
    with recursive up as (
      select id, parent_event_id from public.events where id = p_event_id
      union all
      select e.id, e.parent_event_id
      from public.events e join up on e.id = up.parent_event_id
    )
    select id into v_root_id from up where parent_event_id is null limit 1;

    if v_root_id is not null then
      select discount_enabled, discount_amount into v_disc_en, v_disc_amt
      from public.events where id = v_root_id;

      if coalesce(v_disc_en, false) and coalesce(v_disc_amt, 0) > 0 then
        with recursive down as (
          select id from public.events where id = v_root_id
          union all
          select e.id from public.events e join down on e.parent_event_id = down.id
        )
        select exists (
          select 1 from public.registrations r
          where r.profile_id = v_uid
            and r.payment_status = 'verified'
            and r.event_id <> p_event_id
            and r.event_id in (select id from down)
        ) into v_eligible;

        if v_eligible then
          v_amount := greatest(v_amount - v_disc_amt, 0);
        end if;
      end if;
    end if;
  end if;

  insert into public.registrations (
    profile_id, event_id, amount, registration_status, payment_status
  ) values (
    v_uid, p_event_id, v_amount,
    (case when v_amount = 0 then 'confirmed' else 'pending' end)::registration_status,
    (case when v_amount = 0 then 'verified'  else 'unpaid'  end)::payment_status
  )
  on conflict (profile_id, event_id) do update
    set amount = v_amount,
        registration_status = (case
          when v_amount = 0 then 'confirmed' else 'pending' end)::registration_status,
        payment_status = (case
          when v_amount = 0 then 'verified' else 'unpaid' end)::payment_status
    where public.registrations.registration_status = 'cancelled'
  returning * into v_reg;

  return v_reg;
end $$;
