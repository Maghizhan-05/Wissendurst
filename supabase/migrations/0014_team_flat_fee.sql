-- ============================================================================
-- WISSENDRUST'27 — 0014_team_flat_fee
-- A team pays a single FLAT fee (the event's registration_fee) regardless of
-- how many members are on the team — not fee × size. The head's registration
-- carries that flat amount; teammates stay at 0 and are confirmed when the
-- head's payment is verified.
-- ============================================================================

create or replace function public.register_team(
  p_event_id uuid,
  p_member_ids uuid[]
)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_event public.events;
  v_ids uuid[];
  v_size int;
  v_taken int;
  v_total int;
  v_team_id uuid;
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
  if not v_event.team_enabled then
    raise exception 'NOT_TEAM_EVENT';
  end if;
  if not v_event.is_live then
    raise exception 'NOT_LIVE';
  end if;
  if not v_event.registration_open then
    raise exception 'REGISTRATION_CLOSED';
  end if;

  -- Distinct member set, always including the head.
  select array(
    select distinct x
    from unnest(coalesce(p_member_ids, array[]::uuid[]) || array[v_uid]) as x
  ) into v_ids;
  v_size := coalesce(array_length(v_ids, 1), 0);

  if v_size < v_event.team_min then
    raise exception 'TEAM_TOO_SMALL';
  end if;
  if v_size > v_event.team_max then
    raise exception 'TEAM_TOO_LARGE';
  end if;

  -- Every member must be an approved participant.
  if exists (
    select 1 from unnest(v_ids) as mid
    where not exists (
      select 1 from public.profiles p
      where p.id = mid and p.approval_status = 'approved'
    )
  ) then
    raise exception 'MEMBER_NOT_APPROVED';
  end if;

  -- Nobody may already hold an active registration for this event (solo OR on
  -- any other team) — one team per person per event.
  if exists (
    select 1 from public.registrations r
    where r.event_id = p_event_id
      and r.registration_status <> 'cancelled'
      and r.profile_id = any (v_ids)
  ) then
    raise exception 'MEMBER_ALREADY_REGISTERED';
  end if;

  if v_event.max_participants is not null then
    select count(*) into v_taken from public.registrations
    where event_id = p_event_id and registration_status in ('pending','confirmed');
    if v_taken + v_size > v_event.max_participants then
      raise exception 'EVENT_FULL';
    end if;
  end if;

  insert into public.teams (event_id, head_profile_id)
  values (p_event_id, v_uid)
  returning id into v_team_id;

  -- Single flat fee for the whole team (NOT multiplied by team size).
  v_total := v_event.registration_fee;

  -- Head registration carries the flat fee and is the payable one.
  insert into public.registrations (
    profile_id, event_id, amount, registration_status, payment_status,
    team_id, is_team_head
  ) values (
    v_uid, p_event_id, v_total,
    (case when v_total = 0 then 'confirmed' else 'pending' end)::registration_status,
    (case when v_total = 0 then 'verified'  else 'unpaid'  end)::payment_status,
    v_team_id, true
  )
  returning * into v_reg;

  -- Teammates ride on the team: zero individual amount, confirmed when the
  -- head's payment is verified (admin_set_payment_status cascade).
  insert into public.registrations (
    profile_id, event_id, amount, registration_status, payment_status,
    team_id, is_team_head
  )
  select mid, p_event_id, 0,
    (case when v_total = 0 then 'confirmed' else 'pending' end)::registration_status,
    (case when v_total = 0 then 'verified'  else 'unpaid'  end)::payment_status,
    v_team_id, false
  from unnest(v_ids) as mid
  where mid <> v_uid;

  return v_reg;
end $$;

grant execute on function public.register_team(uuid, uuid[]) to authenticated;
