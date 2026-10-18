-- ============================================================================
-- WISSENDRUST'27 — 0008_event_live
-- "Live" flag on events. Only live events accept registration; non-live events
-- show as "Coming soon" (locked) on the site. Admins toggle it per event.
-- ============================================================================

alter table public.events
  add column if not exists is_live boolean not null default false;

-- Existing events stay registerable; new events start as "coming soon".
update public.events set is_live = true;

-- Enforce it server-side in the registration RPC (recreated with the enum casts
-- the live DB already uses, plus the new NOT_LIVE guard).
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

  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'EVENT_NOT_FOUND';
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

  insert into public.registrations (
    profile_id, event_id, amount, registration_status, payment_status
  ) values (
    v_uid, p_event_id, v_event.registration_fee,
    (case when v_event.registration_fee = 0 then 'confirmed' else 'pending' end)::registration_status,
    (case when v_event.registration_fee = 0 then 'verified'  else 'unpaid'  end)::payment_status
  )
  on conflict (profile_id, event_id) do update
    set registration_status = (case
          when v_event.registration_fee = 0 then 'confirmed' else 'pending' end)::registration_status,
        payment_status = (case
          when v_event.registration_fee = 0 then 'verified' else 'unpaid' end)::payment_status
    where public.registrations.registration_status = 'cancelled'
  returning * into v_reg;

  return v_reg;
end $$;
