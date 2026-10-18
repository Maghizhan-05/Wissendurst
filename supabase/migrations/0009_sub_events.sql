-- ============================================================================
-- WISSENDRUST'27 — 0009_sub_events
-- Sub-events: a "broader" event (e.g. "Quiz", "Workshops") can hold several
-- sub-events that participants actually register for. Modelled as a single
-- self-referential tree on public.events:
--   * parent_event_id IS NULL  -> top-level event (a container OR a standalone)
--   * parent_event_id = <id>   -> a sub-event of that container
-- Registration, payments, capacity, fees and the Excel export all keep working
-- per-event, so every sub-event behaves like a normal event. Collections roll
-- up from sub-events to their parent in the app layer.
-- One level only: a sub-event can't itself be a parent (enforced in the app).
-- ============================================================================

alter table public.events
  add column if not exists parent_event_id uuid
    references public.events(id) on delete cascade;

create index if not exists events_parent_event_id_idx
  on public.events(parent_event_id);

-- A container event (one that has sub-events) must not be registered for
-- directly — registration happens on its sub-events. Recreated with the enum
-- casts the live DB already uses, plus the existing NOT_LIVE guard and the new
-- HAS_SUBEVENTS guard.
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
