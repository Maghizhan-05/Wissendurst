-- ============================================================================
-- WISSENDRUST'27 — 0015_discount_3tier_and_team_fee
-- (1) Re-ship the sibling-discount function so the FULL ancestor chain is
--     honoured (works across all three tiers). Enable the discount on the
--     shared parent (e.g. "poster") OR any higher ancestor (e.g.
--     "presentation"); a verified payment on one descendant then discounts
--     another descendant under that same ancestor.
-- (2) Separate fees: registration_fee = the lone-participant fee (a team of
--     one), team_fee = the flat fee a real team (2+) pays.
-- ============================================================================

-- (2) Flat team fee column, defaulting existing team events to their current
--     (registration) fee so behaviour is unchanged until admins set it.
alter table public.events
  add column if not exists team_fee integer not null default 0; -- paise
update public.events set team_fee = registration_fee where team_fee = 0;

-- (1) Discount across the whole ancestor chain. -------------------------------
create or replace function public.register_for_event(p_event_id uuid)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_event public.events;
  v_count int;
  v_reg public.registrations;
  v_anc record;
  v_disc_en boolean;
  v_disc_amt int;
  v_amount int;
  v_eligible boolean;
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

  v_amount := v_event.registration_fee;

  -- Walk EVERY ancestor (parent, grandparent, … to the root). For the nearest
  -- one whose discount is enabled AND under whose subtree the user already has
  -- a verified payment on another event, apply that discount.
  if v_amount > 0 then
    for v_anc in
      with recursive up as (
        select id, parent_event_id, 0 as lvl from public.events where id = p_event_id
        union all
        select e.id, e.parent_event_id, up.lvl + 1
        from public.events e join up on e.id = up.parent_event_id
      )
      select id from up where id <> p_event_id order by lvl asc
    loop
      select discount_enabled, discount_amount into v_disc_en, v_disc_amt
      from public.events where id = v_anc.id;

      if coalesce(v_disc_en, false) and coalesce(v_disc_amt, 0) > 0 then
        with recursive down as (
          select id from public.events where id = v_anc.id
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
          exit;
        end if;
      end if;
    end loop;
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

-- (2) Team registration uses the lone fee for a team of one, the flat team fee
--     for a real team. ---------------------------------------------------------
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

  if exists (
    select 1 from unnest(v_ids) as mid
    where not exists (
      select 1 from public.profiles p
      where p.id = mid and p.approval_status = 'approved'
    )
  ) then
    raise exception 'MEMBER_NOT_APPROVED';
  end if;

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

  -- Lone participant (team of one) pays the individual registration fee; a real
  -- team pays the single flat team fee.
  if v_size <= 1 then
    v_total := v_event.registration_fee;
  else
    v_total := v_event.team_fee;
  end if;

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
