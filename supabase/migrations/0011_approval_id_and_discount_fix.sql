-- ============================================================================
-- WISSENDRUST'27 — 0011_approval_id_and_discount_fix
-- (1) Participant IDs are now assigned ONLY when an admin approves the signup,
--     not at signup time. Pending users have a null participant_id (shown as
--     "Pending" in the admin panel).
-- (2) Discount fix: the sibling discount is now read from the NEAREST ancestor
--     that has it enabled (any level — broader event OR sub-event), instead of
--     only the top-level root. This matches a discount set on, say, "Poster"
--     for its sub-events.
-- ============================================================================

-- (1) Stop auto-assigning the id at insert; allow null until approval. ---------
alter table public.profiles alter column participant_id drop not null;
drop trigger if exists trg_assign_participant_id on public.profiles;

-- Clear ids the old insert-trigger already minted for users still pending, so
-- unapproved accounts show no participant id until an admin approves them.
update public.profiles set participant_id = null where approval_status = 'pending';

-- Approval RPC now mints the participant id on first approval.
create or replace function public.admin_set_approval(
  p_user_id uuid,
  p_status  approval_status
)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare v_row public.profiles;
begin
  if not public.has_admin_scope('signups') then raise exception 'FORBIDDEN'; end if;

  update public.profiles set
    approval_status = p_status,
    approved_by = auth.uid(),
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    participant_id = case
      when p_status = 'approved' and (participant_id is null or participant_id = '')
        then 'W27/E/' || lpad(nextval('public.participant_seq')::text, 4, '0')
      else participant_id
    end
  where id = p_user_id
  returning * into v_row;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  return v_row;
end $$;

grant execute on function public.admin_set_approval(uuid, approval_status) to authenticated;

-- (2) Discount now walks up from the registered event and applies the nearest
--     ancestor whose discount is enabled and under which the user already has a
--     verified (paid) sibling registration. -----------------------------------
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

  -- Sibling discount: nearest ancestor (parent, grandparent, …) whose discount
  -- is enabled AND under whose subtree the user already has a verified payment.
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
          exit; -- nearest enabled + eligible ancestor wins
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
