-- ============================================================================
-- WISSENDURST'27 — 0036_self_withdraw_and_team_add_cancel (D-029)
--
-- A. cancel_my_registration(p_registration_id): a participant withdraws a
--    genuinely unpaid intent — pending + unpaid, no screenshot, UTR/
--    transaction, duplicate link or UTR claim. Solo: that row is cancelled
--    and its seat released. Team head: every row of the unpaid team is
--    cancelled atomically. Non-head teammate: NOT_TEAM_HEAD. Anything else:
--    NOT_CANCELLABLE. Caller from auth.uid(); per-event advisory lock, rows
--    reloaded FOR UPDATE and revalidated; one PII-free payment_events entry
--    per affected registration.
-- B. register_team / edit_team_roster absorb a teammate's eligible SOLO
--    unpaid intent (no team, or head of a team of exactly one) into the new
--    team, reusing the same row; its held seat is not counted twice.
--    Teams of two or more (heads and members), evidence-bearing and
--    confirmed rows stay MEMBER_ALREADY_REGISTERED; banned: MEMBER_BANNED.
-- C. registration_blocks_team_add(): the same rule for the server-side
--    teammate lookup. registration_blocks_new is unchanged.
-- D. The legacy unlocked cancel_registration(uuid) (0003: no lock, no team
--    rule, cancelled uploaded rows) is no longer callable by clients.
-- Bodies of register_team / edit_team_roster are 0030's (identical to live)
-- with the D-029 changes only. Safe to re-run.
-- ============================================================================

-- ── shared eligibility (internal) ──────────────────────────────────────────
create or replace function public.registration_withdrawable(r public.registrations)
returns boolean language sql stable security definer set search_path = public as $$
  select r.registration_status = 'pending'
     and r.payment_status = 'unpaid'
     and r.payment_screenshot is null
     and r.transaction_id is null
     and r.duplicate_of is null
     and not exists (select 1 from public.payment_utr_claims c where c.registration_id = r.id);
$$;
revoke execute on function public.registration_withdrawable(public.registrations) from public, anon, authenticated;

-- A solo intent: no team, or the head of a team of exactly one.
create or replace function public.registration_absorbable(r public.registrations)
returns boolean language sql stable security definer set search_path = public as $$
  select public.registration_withdrawable(r)
     and (r.team_id is null
          or (r.is_team_head
              and not exists (select 1 from public.registrations o
                              where o.team_id = r.team_id and o.id <> r.id)));
$$;
revoke execute on function public.registration_absorbable(public.registrations) from public, anon, authenticated;

-- ── A. participant withdrawal ──────────────────────────────────────────────
create or replace function public.cancel_my_registration(p_registration_id uuid)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_event_id uuid;
  v_reg public.registrations;
  v_row public.registrations;
  v_size int;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select event_id into v_event_id from public.registrations
   where id = p_registration_id and profile_id = v_uid;
  if v_event_id is null then raise exception 'REGISTRATION_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtext(v_event_id::text));

  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found or v_reg.profile_id <> v_uid then raise exception 'REGISTRATION_NOT_FOUND'; end if;
  if v_reg.team_id is not null and not v_reg.is_team_head then
    raise exception 'NOT_TEAM_HEAD';
  end if;
  if not public.registration_withdrawable(v_reg) then
    raise exception 'NOT_CANCELLABLE';
  end if;

  if v_reg.team_id is null then
    update public.registrations
       set registration_status = 'cancelled', hold_expires_at = null
     where id = v_reg.id
     returning * into v_row;
    insert into public.payment_events(registration_id, actor_id, action, from_status, to_status, note)
    values (v_row.id, v_uid, 'intent_withdrawn', 'unpaid', 'unpaid',
            'Unpaid intent withdrawn by the participant; seat released');
    return v_row;
  end if;

  -- Team head: lock every row, revalidate, then cancel them all.
  perform 1 from public.registrations where team_id = v_reg.team_id order by id for update;
  if exists (select 1 from public.registrations
              where team_id = v_reg.team_id and registration_status not in ('pending', 'cancelled')) then
    raise exception 'NOT_CANCELLABLE';
  end if;
  select count(*)::int into v_size from public.registrations
   where team_id = v_reg.team_id and registration_status = 'pending';

  for v_row in
    update public.registrations
       set registration_status = 'cancelled', hold_expires_at = null
     where team_id = v_reg.team_id and registration_status = 'pending'
     returning *
  loop
    insert into public.payment_events(registration_id, actor_id, action, from_status, to_status, note)
    values (v_row.id, v_uid, 'team_intent_withdrawn', v_row.payment_status, v_row.payment_status,
            'Unpaid team intent withdrawn by the team head; team of ' || v_size || ' cancelled, seats released');
  end loop;

  select * into v_row from public.registrations where id = v_reg.id;
  return v_row;
end $$;
revoke execute on function public.cancel_my_registration(uuid) from public, anon;
grant execute on function public.cancel_my_registration(uuid) to authenticated;

-- ── D. legacy unlocked cancel: server-side only ────────────────────────────
revoke execute on function public.cancel_registration(uuid) from public, anon, authenticated;

-- ── C. teammate lookup (server-only) ───────────────────────────────────────
create or replace function public.registration_blocks_team_add(p_profile_id uuid, p_event_id uuid, p_exclude_team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.registrations r
    cross join lateral public.registration_effective_state(r.id) s
    where r.profile_id = p_profile_id and r.event_id = p_event_id
      and not s.reusable
      and r.team_id is distinct from p_exclude_team_id
      and not (public.registration_absorbable(r) and not public.is_user_banned(r.profile_id))
  );
$$;
revoke all on function public.registration_blocks_team_add(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.registration_blocks_team_add(uuid, uuid, uuid) to service_role;

-- ── B. team registration / roster edit absorb eligible solo intents ────────
create or replace function public.register_team(p_event_id uuid, p_member_ids uuid[], p_team_name text default null)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_event public.events;
  v_ids uuid[];
  v_size int;
  v_total int;
  v_price record;
  v_team_id uuid;
  v_name text;
  v_reg public.registrations;
  v_row public.registrations;
  v_existing public.registrations;
  v_mid uuid;
  v_is_head boolean;
  v_hold timestamptz;
  v_rs registration_status;
  v_ps payment_status;
  v_absorb_seats int := 0;
  v_absorbed boolean;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if v_event.archived_at is not null then
    raise exception 'EVENT_ARCHIVED';
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
  -- Teams of two or more need a name; a person on their own has none.
  v_name := case when v_size >= 2 then public.team_name_normalized(p_team_name) else null end;

  if v_event.general_registration_covered and exists (
    select 1 from unnest(v_ids) as mid where not public.is_general_registered(mid)
  ) then
    raise exception 'GENERAL_REGISTRATION_REQUIRED';
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
    cross join lateral public.registration_effective_state(r.id) s
    where r.event_id = p_event_id
      and r.profile_id = any (v_ids)
      and not s.reusable
      -- D-029: a teammate's eligible solo unpaid intent is absorbed, not a conflict.
      and not (r.profile_id <> v_uid and public.registration_absorbable(r))
  ) then
    raise exception 'MEMBER_ALREADY_REGISTERED';
  end if;
  -- A banned participant's intent is never absorbed (the insert path refuses
  -- them too, via registrations_guard_banned).
  if exists (
    select 1 from public.registrations r
    where r.event_id = p_event_id and r.profile_id = any (v_ids) and r.profile_id <> v_uid
      and public.registration_absorbable(r) and public.is_user_banned(r.profile_id)
  ) then
    raise exception 'MEMBER_BANNED';
  end if;
  -- Seats the absorbed intents already hold are the same seats (no double count).
  select count(*)::int into v_absorb_seats
    from public.registrations r
    cross join lateral public.registration_effective_state(r.id) s
   where r.event_id = p_event_id and r.profile_id = any (v_ids) and r.profile_id <> v_uid
     and public.registration_absorbable(r) and s.holds_seat;

  if v_event.max_participants is not null
     and public.event_seats_taken(p_event_id) + v_size - v_absorb_seats > v_event.max_participants then
    raise exception 'EVENT_FULL';
  end if;

  -- Price for this exact team size (0030); the head's best offer applies.
  select * into v_price from public.event_offer_price(v_uid, p_event_id, v_size);
  v_total := v_price.amount;
  v_hold := case when v_total = 0 then null else now() + interval '72 hours' end;
  v_rs := (case when v_total = 0 then 'confirmed' else 'pending' end)::registration_status;
  v_ps := (case when v_total = 0 then 'verified'  else 'unpaid'  end)::payment_status;

  insert into public.teams (event_id, head_profile_id, name)
  values (p_event_id, v_uid, v_name)
  returning id into v_team_id;

  foreach v_mid in array (array[v_uid] || array_remove(v_ids, v_uid)) loop
    v_is_head := (v_mid = v_uid);
    v_existing := null;
    select * into v_existing from public.registrations
    where profile_id = v_mid and event_id = p_event_id
    for update;
    v_absorbed := v_existing.id is not null and v_mid <> v_uid
                  and public.registration_absorbable(v_existing)
                  and not (select s.reusable from public.registration_effective_state(v_existing.id) s);

    if v_existing.id is null then
      insert into public.registrations (
        profile_id, event_id, amount, registration_status, payment_status,
        team_id, is_team_head, hold_expires_at,
        list_price, offer_discount, offer_source_event_id
      ) values (
        v_mid, p_event_id, case when v_is_head then v_total else 0 end,
        v_rs, v_ps, v_team_id, v_is_head, v_hold,
        case when v_is_head then v_price.list_price else null end,
        case when v_is_head then v_price.discount else 0 end,
        case when v_is_head then v_price.source_event_id else null end
      )
      returning * into v_row;
    else
      update public.registrations set
        amount = case when v_is_head then v_total else 0 end,
        list_price = case when v_is_head then v_price.list_price else null end,
        offer_discount = case when v_is_head then v_price.discount else 0 end,
        offer_source_event_id = case when v_is_head then v_price.source_event_id else null end,
        registration_status = v_rs,
        payment_status = v_ps,
        hold_expires_at = v_hold,
        transaction_id = null,
        duplicate_of = null,
        payment_screenshot = null,
        ocr_raw_text = null,
        ocr_confidence = null,
        team_id = v_team_id,
        is_team_head = v_is_head,
        verified_at = null,
        verified_by = null,
        registered_at = now()
      where id = v_existing.id
      returning * into v_row;

      insert into public.payment_events(registration_id, actor_id, action, from_status, to_status, note)
      values (v_row.id, v_uid,
              case when v_absorbed then 'solo_intent_absorbed' else 'intent_refreshed' end,
              v_existing.payment_status, v_row.payment_status,
              case when v_absorbed then 'Unpaid solo intent absorbed into a new team (same seat)'
                   else 'Previous ' || v_existing.registration_status::text || ' intent reused for a new team' end);
    end if;

    if v_is_head then
      v_reg := v_row;
    end if;
  end loop;

  return v_reg;
end $$;
revoke execute on function public.register_team(uuid, uuid[], text) from public, anon;
grant execute on function public.register_team(uuid, uuid[], text) to authenticated;

create or replace function public.edit_team_roster(
  p_registration_id uuid,
  p_member_ids uuid[],
  p_team_name text default null
)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_event_id uuid;
  v_event public.events;
  v_head public.registrations;
  v_ids uuid[];
  v_old uuid[];
  v_added uuid[];
  v_removed uuid[];
  v_size int;
  v_old_size int;
  v_name text;
  v_old_name text;
  v_price record;
  v_total int;
  v_rs registration_status;
  v_ps payment_status;
  v_hold timestamptz;
  v_mid uuid;
  v_existing public.registrations;
  v_note text;
  v_absorb_seats int := 0;
  v_absorbed boolean;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select event_id into v_event_id from public.registrations where id = p_registration_id;
  if v_event_id is null then raise exception 'REGISTRATION_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtext(v_event_id::text));

  select * into v_head from public.registrations where id = p_registration_id for update;
  if not found or v_head.profile_id <> v_uid or not v_head.is_team_head or v_head.team_id is null then
    raise exception 'REGISTRATION_NOT_FOUND';
  end if;
  if not public.team_roster_editable(v_head) then
    raise exception 'ROSTER_LOCKED';
  end if;
  select * into v_event from public.events where id = v_head.event_id;
  if v_event.archived_at is not null then raise exception 'EVENT_ARCHIVED'; end if;

  perform 1 from public.registrations where team_id = v_head.team_id for update;
  select array_agg(profile_id order by profile_id) into v_old
    from public.registrations where team_id = v_head.team_id;
  select name into v_old_name from public.teams where id = v_head.team_id for update;

  select array(
    select distinct x from unnest(coalesce(p_member_ids, array[]::uuid[]) || array[v_uid]) as x
  ) into v_ids;
  v_size := coalesce(array_length(v_ids, 1), 0);
  v_old_size := coalesce(array_length(v_old, 1), 0);
  v_added := array(select x from unnest(v_ids) x where not x = any (v_old));
  v_removed := array(select x from unnest(v_old) x where not x = any (v_ids));

  if v_size < v_event.team_min then raise exception 'TEAM_TOO_SMALL'; end if;
  if v_size > v_event.team_max then raise exception 'TEAM_TOO_LARGE'; end if;
  v_name := case when v_size >= 2 then public.team_name_normalized(p_team_name) else null end;

  if cardinality(v_added) > 0 then
    if not v_event.is_live then raise exception 'NOT_LIVE'; end if;
    if not v_event.registration_open then raise exception 'REGISTRATION_CLOSED'; end if;
    if exists (select 1 from unnest(v_added) mid
               where not exists (select 1 from public.profiles p where p.id = mid and p.approval_status = 'approved')) then
      raise exception 'MEMBER_NOT_APPROVED';
    end if;
    if exists (
      select 1 from public.registrations r
      cross join lateral public.registration_effective_state(r.id) s
      where r.event_id = v_head.event_id and r.profile_id = any (v_added)
        and not s.reusable and r.team_id is distinct from v_head.team_id
        -- D-029: an eligible solo unpaid intent is absorbed, not a conflict.
        and not public.registration_absorbable(r)
    ) then
      raise exception 'MEMBER_ALREADY_REGISTERED';
    end if;
    if exists (
      select 1 from public.registrations r
      where r.event_id = v_head.event_id and r.profile_id = any (v_added)
        and public.registration_absorbable(r) and public.is_user_banned(r.profile_id)
    ) then
      raise exception 'MEMBER_BANNED';
    end if;
    select count(*)::int into v_absorb_seats
      from public.registrations r
      cross join lateral public.registration_effective_state(r.id) s
     where r.event_id = v_head.event_id and r.profile_id = any (v_added)
       and public.registration_absorbable(r) and s.holds_seat;
  end if;
  if v_event.general_registration_covered and exists (
    select 1 from unnest(v_ids) mid where not public.is_general_registered(mid)
  ) then
    raise exception 'GENERAL_REGISTRATION_REQUIRED';
  end if;
  -- The team's own seats and absorbed solo holds are already counted; only
  -- net growth needs room.
  if v_event.max_participants is not null and v_size - v_old_size - v_absorb_seats > 0
     and public.event_seats_taken(v_head.event_id) - v_old_size - v_absorb_seats + v_size > v_event.max_participants then
    raise exception 'EVENT_FULL';
  end if;

  if cardinality(v_added) = 0 and cardinality(v_removed) = 0
     and v_name is not distinct from v_old_name then
    return v_head;                                   -- nothing changed
  end if;

  select * into v_price from public.event_offer_price(v_uid, v_head.event_id, v_size);
  v_total := v_price.amount;
  -- A team whose new price is ₹0 is confirmed straight away (as register_team does).
  v_rs := (case when v_total = 0 then 'confirmed' else 'pending' end)::registration_status;
  v_ps := (case when v_total = 0 then 'verified' else 'unpaid' end)::payment_status;
  v_hold := case when v_total = 0 then null else v_head.hold_expires_at end;   -- never extended

  -- Removed teammates: their registrations are deleted (they never paid).
  delete from public.registrations
   where team_id = v_head.team_id and profile_id = any (v_removed) and not is_team_head;

  -- Added teammates: new rows, or reuse their cancelled/expired row.
  foreach v_mid in array v_added loop
    v_existing := null;
    select * into v_existing from public.registrations where profile_id = v_mid and event_id = v_head.event_id
      for update;
    v_absorbed := v_existing.id is not null
                  and public.registration_absorbable(v_existing)
                  and not (select s.reusable from public.registration_effective_state(v_existing.id) s);
    if v_existing.id is null then
      insert into public.registrations (profile_id, event_id, amount, registration_status, payment_status,
                                        team_id, is_team_head, hold_expires_at, list_price, offer_discount)
      values (v_mid, v_head.event_id, 0, v_rs, v_ps, v_head.team_id, false, v_hold, null, 0);
    else
      update public.registrations set
        amount = 0, list_price = null, offer_discount = 0, offer_source_event_id = null,
        registration_status = v_rs, payment_status = v_ps, hold_expires_at = v_hold,
        transaction_id = null, duplicate_of = null, payment_screenshot = null,
        ocr_raw_text = null, ocr_confidence = null,
        team_id = v_head.team_id, is_team_head = false,
        verified_at = null, verified_by = null, registered_at = now()
      where id = v_existing.id;
      insert into public.payment_events(registration_id, actor_id, action, from_status, to_status, note)
      values (v_existing.id, v_uid,
              case when v_absorbed then 'solo_intent_absorbed' else 'intent_refreshed' end,
              v_existing.payment_status, v_ps,
              case when v_absorbed then 'Unpaid solo intent absorbed when added to a team (same seat)'
                   else 'Previous ' || v_existing.registration_status::text || ' intent reused when added to a team' end);
    end if;
  end loop;

  if v_total = 0 then
    update public.registrations set registration_status = v_rs, payment_status = v_ps, hold_expires_at = null
     where team_id = v_head.team_id and not is_team_head;
  end if;

  update public.registrations set
    amount = v_total,
    list_price = v_price.list_price,
    offer_discount = v_price.discount,
    offer_source_event_id = v_price.source_event_id,
    registration_status = v_rs,
    payment_status = v_ps,
    hold_expires_at = v_hold
  where id = v_head.id
  returning * into v_head;

  update public.teams set name = v_name where id = v_head.team_id;

  -- Audit on the head's (surviving) registration: counts only, no names/IDs.
  v_note := 'Team edited: size ' || v_old_size || ' -> ' || v_size
            || ', added ' || cardinality(v_added) || ', removed ' || cardinality(v_removed)
            || case when v_name is distinct from v_old_name then ', name changed' else '' end
            || ', amount ' || v_total;
  insert into public.payment_events(registration_id, actor_id, action, from_status, to_status, note)
  values (v_head.id, v_uid, 'roster_edited', 'unpaid', v_ps, v_note);

  return v_head;
end $$;
revoke execute on function public.edit_team_roster(uuid, uuid[], text) from public, anon;
grant execute on function public.edit_team_roster(uuid, uuid[], text) to authenticated;
