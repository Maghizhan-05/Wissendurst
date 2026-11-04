-- ============================================================================
-- WISSENDURST'27 — 0017_payment_intents
-- Pending registrations become PAYMENT INTENTS with a 72-hour capacity hold.
--
-- Seat rules (one source of truth: registration_effective_state):
--   * confirmed                                   → holds a seat
--   * pending + under_review (UTR submitted)      → holds a seat until an
--                                                   admin verifies/rejects
--   * pending + unpaid / uploaded / duplicate     → holds a seat until
--                                                   hold_expires_at (72 h)
--   * rejected / cancelled / expired intent       → no seat
--   Team members follow their team head's state (the head pays for all).
--
-- Behaviour:
--   * The price (amount) is frozen when the intent is created or refreshed.
--   * Capacity is checked atomically (per-event advisory lock) for individual
--     and team registration and for re-submission after a rejection.
--   * Expired intents (and cancelled rows) are refreshed in place instead of
--     raising ALREADY_REGISTERED; teammates' expired rows are reused too.
--   * submit_payment refuses archived events, cancelled/expired intents,
--     already-paid rows and non-head teammates; admins can still resolve
--     payments on archived events.
--   * Duplicate-UTR detection and the team verification cascade are kept.
-- Forward-only and safe to re-run.
-- ============================================================================

-- ── Column ───────────────────────────────────────────────────────────────────
-- Volatile default: every new row gets a fresh 72-hour window unless a
-- function sets it explicitly. Existing pending intents get 72 h from now.
alter table public.registrations
  add column if not exists hold_expires_at timestamptz
    default (now() + interval '72 hours');

-- Only timed intents keep a hold timestamp (without touching updated_at).
alter table public.registrations disable trigger trg_reg_updated;
update public.registrations
   set hold_expires_at = null
 where hold_expires_at is not null
   and not (registration_status = 'pending'
            and payment_status in ('unpaid', 'uploaded', 'duplicate'));
alter table public.registrations enable trigger trg_reg_updated;

create index if not exists idx_reg_event_status
  on public.registrations(event_id, registration_status);
create index if not exists idx_reg_team on public.registrations(team_id)
  where team_id is not null;

-- ── State helpers ────────────────────────────────────────────────────────────
create or replace function public.reg_state_holds(
  p_rs registration_status, p_ps payment_status, p_hold timestamptz
) returns boolean
language sql stable set search_path = public as $$
  select p_rs = 'confirmed'
      or (p_rs = 'pending'
          and (p_ps = 'under_review'
               or (p_ps in ('unpaid', 'uploaded', 'duplicate')
                   and coalesce(p_hold > now(), false))));
$$;

create or replace function public.reg_state_expired(
  p_rs registration_status, p_ps payment_status, p_hold timestamptz
) returns boolean
language sql stable set search_path = public as $$
  select p_rs = 'pending'
     and p_ps in ('unpaid', 'uploaded', 'duplicate')
     and coalesce(p_hold <= now(), true);
$$;

-- Effective state of one registration: a teammate (non-head) follows the
-- team head; a row cancelled by its owner stays cancelled.
create or replace function public.registration_effective_state(p_reg_id uuid)
returns table (
  holds_seat boolean,
  expired_intent boolean,
  reusable boolean,
  effective_registration_status registration_status,
  effective_payment_status payment_status,
  effective_hold_expires_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with base as (
    select r.*,
           hd.registration_status as h_rs,
           hd.payment_status      as h_ps,
           hd.hold_expires_at     as h_hold,
           (hd.id is not null)    as follows_head
    from public.registrations r
    left join lateral (
      select h.id, h.registration_status, h.payment_status, h.hold_expires_at
      from public.registrations h
      where r.team_id is not null and not r.is_team_head
        and h.team_id = r.team_id and h.is_team_head
      limit 1
    ) hd on true
    where r.id = p_reg_id
  ), eff as (
    select
      case when registration_status = 'cancelled' then 'cancelled'::registration_status
           when follows_head then h_rs else registration_status end as rs,
      case when follows_head then h_ps else payment_status end     as ps,
      case when follows_head then h_hold else hold_expires_at end  as hold
    from base
  )
  select public.reg_state_holds(rs, ps, hold),
         public.reg_state_expired(rs, ps, hold),
         rs = 'cancelled' or public.reg_state_expired(rs, ps, hold),
         rs, ps, hold
  from eff;
$$;

-- Seats currently taken on an event (confirmed + live holds).
create or replace function public.event_seats_taken(p_event_id uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.registrations r
  cross join lateral public.registration_effective_state(r.id) s
  where r.event_id = p_event_id and s.holds_seat;
$$;

-- Public, aggregate-only capacity numbers for non-archived events.
create or replace function public.event_capacity_counts()
returns table (event_id uuid, seats_taken integer, confirmed integer)
language sql stable security definer set search_path = public as $$
  select r.event_id,
         (count(*) filter (where s.holds_seat))::int,
         (count(*) filter (where r.registration_status = 'confirmed'))::int
  from public.registrations r
  join public.events e on e.id = r.event_id and e.archived_at is null
  cross join lateral public.registration_effective_state(r.id) s
  group by r.event_id;
$$;

-- The signed-in user's registrations with their effective intent state.
create or replace function public.my_registration_states()
returns table (
  registration_id uuid,
  event_id uuid,
  holds_seat boolean,
  expired_intent boolean,
  reusable boolean,
  effective_registration_status registration_status,
  effective_payment_status payment_status,
  effective_hold_expires_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select r.id, r.event_id, s.holds_seat, s.expired_intent, s.reusable,
         s.effective_registration_status, s.effective_payment_status,
         s.effective_hold_expires_at
  from public.registrations r
  cross join lateral public.registration_effective_state(r.id) s
  where r.profile_id = auth.uid();
$$;

-- Server-side (service role) check used by the teammate lookup.
create or replace function public.registration_blocks_new(
  p_profile_id uuid, p_event_id uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.registrations r
    cross join lateral public.registration_effective_state(r.id) s
    where r.profile_id = p_profile_id and r.event_id = p_event_id
      and not s.reusable
  );
$$;

-- Admin view of every registration's seat state (collections / reporting).
create or replace function public.admin_registration_states()
returns table (registration_id uuid, event_id uuid, holds_seat boolean, expired_intent boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
  return query
    select r.id, r.event_id, s.holds_seat, s.expired_intent
    from public.registrations r
    cross join lateral public.registration_effective_state(r.id) s;
end $$;

revoke all on function public.registration_effective_state(uuid) from public, anon, authenticated;
revoke all on function public.admin_registration_states() from public, anon;
grant execute on function public.admin_registration_states() to authenticated;
revoke all on function public.event_seats_taken(uuid) from public, anon, authenticated;
revoke all on function public.registration_blocks_new(uuid, uuid) from public, anon, authenticated;
grant execute on function public.registration_blocks_new(uuid, uuid) to service_role;
grant execute on function public.event_capacity_counts() to anon, authenticated;
grant execute on function public.my_registration_states() to authenticated;

-- ── Individual registration: intent with frozen price + 72 h hold ───────────
create or replace function public.register_for_event(p_event_id uuid)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_event public.events;
  v_reg public.registrations;
  v_existing public.registrations;
  v_reusable boolean;
  v_anc record;
  v_disc_en boolean;
  v_disc_amt int;
  v_amount int;
  v_eligible boolean;
  v_hold timestamptz;
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
  if v_event.team_enabled then
    raise exception 'TEAM_EVENT';
  end if;
  if not v_event.is_live then
    raise exception 'NOT_LIVE';
  end if;
  if not v_event.registration_open then
    raise exception 'REGISTRATION_CLOSED';
  end if;

  select * into v_existing from public.registrations
  where profile_id = v_uid and event_id = p_event_id;
  if found then
    select s.reusable into v_reusable
    from public.registration_effective_state(v_existing.id) s;
    if not v_reusable then
      raise exception 'ALREADY_REGISTERED';
    end if;
  end if;

  if v_event.max_participants is not null
     and public.event_seats_taken(p_event_id) >= v_event.max_participants then
    raise exception 'EVENT_FULL';
  end if;

  v_amount := v_event.registration_fee;

  -- Sibling discount across the whole ancestor chain (unchanged from 0015).
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

  v_hold := case when v_amount = 0 then null else now() + interval '72 hours' end;

  if v_existing.id is null then
    insert into public.registrations (
      profile_id, event_id, amount, registration_status, payment_status,
      hold_expires_at
    ) values (
      v_uid, p_event_id, v_amount,
      (case when v_amount = 0 then 'confirmed' else 'pending' end)::registration_status,
      (case when v_amount = 0 then 'verified'  else 'unpaid'  end)::payment_status,
      v_hold
    )
    returning * into v_reg;
  else
    update public.registrations set
      amount = v_amount,
      registration_status = (case when v_amount = 0 then 'confirmed' else 'pending' end)::registration_status,
      payment_status = (case when v_amount = 0 then 'verified' else 'unpaid' end)::payment_status,
      hold_expires_at = v_hold,
      transaction_id = null,
      duplicate_of = null,
      payment_screenshot = null,
      ocr_raw_text = null,
      ocr_confidence = null,
      team_id = null,
      is_team_head = false,
      verified_at = null,
      verified_by = null,
      registered_at = now()
    where id = v_existing.id
    returning * into v_reg;

    insert into public.payment_events(registration_id, actor_id, action, from_status, to_status, note)
    values (v_reg.id, v_uid, 'intent_refreshed', v_existing.payment_status, v_reg.payment_status,
            'Previous ' || v_existing.registration_status::text || ' intent reused');
  end if;

  return v_reg;
end $$;

grant execute on function public.register_for_event(uuid) to authenticated;

-- ── Team registration: one atomic intent for the whole team ─────────────────
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
  v_total int;
  v_team_id uuid;
  v_reg public.registrations;
  v_row public.registrations;
  v_existing public.registrations;
  v_mid uuid;
  v_is_head boolean;
  v_hold timestamptz;
  v_rs registration_status;
  v_ps payment_status;
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

  if exists (
    select 1 from unnest(v_ids) as mid
    where not exists (
      select 1 from public.profiles p
      where p.id = mid and p.approval_status = 'approved'
    )
  ) then
    raise exception 'MEMBER_NOT_APPROVED';
  end if;

  -- Anyone with a live (non-reusable) registration blocks the team.
  if exists (
    select 1 from public.registrations r
    cross join lateral public.registration_effective_state(r.id) s
    where r.event_id = p_event_id
      and r.profile_id = any (v_ids)
      and not s.reusable
  ) then
    raise exception 'MEMBER_ALREADY_REGISTERED';
  end if;

  if v_event.max_participants is not null
     and public.event_seats_taken(p_event_id) + v_size > v_event.max_participants then
    raise exception 'EVENT_FULL';
  end if;

  -- Lone participant pays the individual fee; a real team the flat team fee.
  if v_size <= 1 then
    v_total := v_event.registration_fee;
  else
    v_total := v_event.team_fee;
  end if;
  v_hold := case when v_total = 0 then null else now() + interval '72 hours' end;
  v_rs := (case when v_total = 0 then 'confirmed' else 'pending' end)::registration_status;
  v_ps := (case when v_total = 0 then 'verified'  else 'unpaid'  end)::payment_status;

  insert into public.teams (event_id, head_profile_id)
  values (p_event_id, v_uid)
  returning id into v_team_id;

  -- Head first, so v_reg is the head's row.
  foreach v_mid in array (array[v_uid] || array_remove(v_ids, v_uid)) loop
    v_is_head := (v_mid = v_uid);
    v_existing := null;
    select * into v_existing from public.registrations
    where profile_id = v_mid and event_id = p_event_id;

    if v_existing.id is null then
      insert into public.registrations (
        profile_id, event_id, amount, registration_status, payment_status,
        team_id, is_team_head, hold_expires_at
      ) values (
        v_mid, p_event_id, case when v_is_head then v_total else 0 end,
        v_rs, v_ps, v_team_id, v_is_head, v_hold
      )
      returning * into v_row;
    else
      update public.registrations set
        amount = case when v_is_head then v_total else 0 end,
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
      values (v_row.id, v_uid, 'intent_refreshed', v_existing.payment_status, v_row.payment_status,
              'Previous ' || v_existing.registration_status::text || ' intent reused for a new team');
    end if;

    if v_is_head then
      v_reg := v_row;
    end if;
  end loop;

  return v_reg;
end $$;

grant execute on function public.register_team(uuid, uuid[]) to authenticated;

-- ── Payment submission ──────────────────────────────────────────────────────
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
  v_event public.events;
  v_txn text;
  v_existing uuid;
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
  if v_reg.registration_status = 'cancelled' then
    raise exception 'REGISTRATION_CANCELLED';
  end if;
  if v_reg.registration_status = 'confirmed' or v_reg.payment_status = 'verified' then
    raise exception 'ALREADY_PAID';
  end if;
  if public.reg_state_expired(v_reg.registration_status, v_reg.payment_status, v_reg.hold_expires_at) then
    raise exception 'HOLD_EXPIRED';
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

  v_txn := nullif(upper(trim(coalesce(p_transaction_id, ''))), '');

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
      transaction_id = null,
      hold_expires_at = v_new_hold
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

grant execute on function public.submit_payment(uuid, text, text, text, numeric) to authenticated;

-- ── Admin review: unchanged cascade, plus intent/hold bookkeeping ───────────
-- Works on archived events too, so payments already in review can be resolved.
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
  if not public.has_admin_scope('payments') then raise exception 'FORBIDDEN'; end if;

  select * into v_reg from public.registrations where id = p_registration_id;
  if not found then raise exception 'REGISTRATION_NOT_FOUND'; end if;
  v_from := v_reg.payment_status;

  -- The row and (for a team) every teammate get the same outcome.
  update public.registrations set
    payment_status = p_status,
    registration_status = case
      when p_status = 'verified' then 'confirmed'::registration_status
      when p_status = 'rejected' then 'rejected'::registration_status
      when registration_status = 'cancelled' then 'cancelled'::registration_status
      else 'pending'::registration_status end,
    verified_at = case when p_status = 'verified' then now() else verified_at end,
    verified_by = case when p_status = 'verified' then v_uid else verified_by end,
    hold_expires_at = case
      when p_status in ('unpaid', 'uploaded', 'duplicate') then now() + interval '72 hours'
      else null end
  where id = p_registration_id
     or (v_reg.team_id is not null and team_id = v_reg.team_id);

  select * into v_reg from public.registrations where id = p_registration_id;

  insert into public.payment_events(registration_id, actor_id, action, from_status, to_status, note)
  values (p_registration_id, v_uid, 'admin_review', v_from, p_status, p_note);
  return v_reg;
end $$;

grant execute on function public.admin_set_payment_status(uuid, payment_status, text) to authenticated;
