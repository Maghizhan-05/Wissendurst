-- ============================================================================
-- WISSENDURST'27 — 0023_general_registration
--
-- General Registration (GR): one payment that covers admin-selected events.
--
--   general_registration_settings   singleton: open/closed, fee (paise),
--                                   DEDICATED UPI id + payee, page copy
--   events.general_registration_covered   admin-selected covered events
--   general_registrations           one payment record per participant;
--                                   fee + UPI destination frozen on creation
--   general_registration_payment_events   append-only audit
--   payment_utr_claims              global UTR claims across event payments
--                                   AND GR payments (one winner per UTR)
--
-- Covered events: a participant without a verified GR gets
-- GENERAL_REGISTRATION_REQUIRED from register_for_event / register_team /
-- submit_payment. A verified GR participant still enrols event by event; the
-- price is 0 but capacity, team-size and duplicate rules all still apply.
--
-- Verifying a GR payment converts the participant's id E -> GR in ONE
-- transaction (profile + both namespaces locked; E released to the reuse
-- pool; next GR allocated; history + audit written). Idempotent; there is no
-- GR -> E path; rejection leaves the E id untouched.
--
-- After this migration GR is disabled, has no UPI id and covers no events.
-- Safe to re-run.
-- ============================================================================

-- ── settings (singleton) ────────────────────────────────────────────────────
create table if not exists public.general_registration_settings (
  id           integer primary key default 1 check (id = 1),
  enabled      boolean not null default false,
  fee          integer not null default 0 check (fee between 0 and 10000000),
  upi_id       text check (upi_id is null or upi_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,255}@[A-Za-z][A-Za-z0-9]{1,63}$'),
  payee_name   text not null default '' check (char_length(payee_name) <= 100),
  description  text not null default '' check (char_length(description) <= 2000),
  instructions text not null default '' check (char_length(instructions) <= 2000),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id) on delete set null,
  constraint general_registration_settings_open_requires_config
    check (not enabled or (fee > 0 and upi_id is not null and btrim(payee_name) <> ''))
);
insert into public.general_registration_settings (id) values (1) on conflict (id) do nothing;

-- ── covered events ──────────────────────────────────────────────────────────
alter table public.events
  add column if not exists general_registration_covered boolean not null default false;

-- ── GR payment records ──────────────────────────────────────────────────────
create table if not exists public.general_registrations (
  id                      uuid primary key default gen_random_uuid(),
  profile_id              uuid not null unique references public.profiles(id) on delete cascade,
  status                  payment_status not null default 'unpaid',
  amount                  integer not null check (amount > 0),     -- frozen fee (paise)
  upi_id                  text not null,                           -- frozen destination
  payee_name              text not null,                           -- frozen payee
  transaction_id          text,
  payment_screenshot      text,
  ocr_raw_text            text,
  ocr_confidence          numeric(4,3),
  review_note             text,
  previous_participant_id text,                                    -- E id released on verification
  new_participant_id      text,                                    -- GR id assigned on verification
  created_at              timestamptz not null default now(),
  submitted_at            timestamptz,
  verified_at             timestamptz,
  verified_by             uuid references public.profiles(id) on delete set null,
  updated_at              timestamptz not null default now()
);
create unique index if not exists uq_general_registrations_txn
  on public.general_registrations (transaction_id) where transaction_id is not null;
create index if not exists idx_general_registrations_status on public.general_registrations (status);

drop trigger if exists trg_general_registrations_updated on public.general_registrations;
create trigger trg_general_registrations_updated before update on public.general_registrations
  for each row execute function public.set_updated_at();

-- ── append-only GR audit ────────────────────────────────────────────────────
create table if not exists public.general_registration_payment_events (
  id                      bigint generated always as identity primary key,
  general_registration_id uuid not null,       -- no FK: audit outlives records
  profile_id              uuid not null,
  actor_id                uuid,
  action                  text not null,
  from_status             payment_status,
  to_status               payment_status,
  note                    text,
  previous_participant_id text,
  new_participant_id      text,
  created_at              timestamptz not null default now()
);
create index if not exists idx_gr_events_record on public.general_registration_payment_events (general_registration_id, created_at);
create index if not exists idx_gr_events_profile on public.general_registration_payment_events (profile_id);

create or replace function public.general_registration_audit_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'GENERAL_REGISTRATION_AUDIT_APPEND_ONLY';
end $$;
drop trigger if exists trg_gr_audit_immutable on public.general_registration_payment_events;
create trigger trg_gr_audit_immutable before update or delete on public.general_registration_payment_events
  for each row execute function public.general_registration_audit_immutable();
drop trigger if exists trg_gr_audit_no_truncate on public.general_registration_payment_events;
create trigger trg_gr_audit_no_truncate before truncate on public.general_registration_payment_events
  for each statement execute function public.general_registration_audit_immutable();

-- ── global UTR claims ───────────────────────────────────────────────────────
-- A claim exists exactly while some payment row holds that UTR. The primary
-- key makes concurrent claims of the same UTR serialise: one wins, the other
-- gets unique_violation (submit_* turn that into status 'duplicate').
create table if not exists public.payment_utr_claims (
  utr                     text primary key,
  registration_id         uuid unique references public.registrations(id) on delete cascade,
  general_registration_id uuid unique references public.general_registrations(id) on delete cascade,
  claimed_at              timestamptz not null default now(),
  constraint payment_utr_claims_one_owner check (num_nonnulls(registration_id, general_registration_id) = 1)
);

create or replace function public.sync_payment_utr_claim()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.transaction_id is not null
     and old.transaction_id is distinct from new.transaction_id then
    if tg_table_name = 'registrations' then
      delete from public.payment_utr_claims where utr = old.transaction_id and registration_id = old.id;
    else
      delete from public.payment_utr_claims where utr = old.transaction_id and general_registration_id = old.id;
    end if;
  end if;
  if new.transaction_id is not null
     and (tg_op = 'INSERT' or old.transaction_id is distinct from new.transaction_id) then
    if tg_table_name = 'registrations' then
      insert into public.payment_utr_claims (utr, registration_id) values (new.transaction_id, new.id);
    else
      insert into public.payment_utr_claims (utr, general_registration_id) values (new.transaction_id, new.id);
    end if;
  end if;
  return null;
end $$;
revoke execute on function public.sync_payment_utr_claim() from public, anon, authenticated;

-- Backfill existing event UTRs before the trigger starts maintaining claims.
insert into public.payment_utr_claims (utr, registration_id)
select transaction_id, id from public.registrations where transaction_id is not null
on conflict do nothing;
insert into public.payment_utr_claims (utr, general_registration_id)
select transaction_id, id from public.general_registrations where transaction_id is not null
on conflict do nothing;
do $$
declare v_missing int;
begin
  select count(*) into v_missing from (
    select transaction_id, id, 'r' k from public.registrations where transaction_id is not null
    union all
    select transaction_id, id, 'g' from public.general_registrations where transaction_id is not null) t
  where not exists (select 1 from public.payment_utr_claims c
                    where c.utr = t.transaction_id
                      and (c.registration_id = t.id or c.general_registration_id = t.id));
  if v_missing > 0 then
    raise exception 'UTR_CLAIM_BACKFILL_CONFLICT: % payment(s) share a UTR across event and General Registration', v_missing;
  end if;
end $$;

drop trigger if exists trg_registrations_utr_claim on public.registrations;
create trigger trg_registrations_utr_claim
  after insert or update of transaction_id on public.registrations
  for each row execute function public.sync_payment_utr_claim();
drop trigger if exists trg_general_registrations_utr_claim on public.general_registrations;
create trigger trg_general_registrations_utr_claim
  after insert or update of transaction_id on public.general_registrations
  for each row execute function public.sync_payment_utr_claim();

-- ── helpers ─────────────────────────────────────────────────────────────────
create or replace function public.is_general_registered(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_profile is not null and exists (
    select 1 from public.general_registrations
    where profile_id = p_profile and status = 'verified');
$$;
revoke execute on function public.is_general_registered(uuid) from public, anon, authenticated;

-- ── guards ──────────────────────────────────────────────────────────────────
-- Coverage changes only through admin_set_general_registration_events().
create or replace function public.guard_event_general_registration()
returns trigger language plpgsql set search_path = public as $$  -- invoker: current_user is the caller
declare v_gr_upi text;
begin
  if current_user in ('anon', 'authenticated') and (
       (tg_op = 'INSERT' and new.general_registration_covered)
    or (tg_op = 'UPDATE' and new.general_registration_covered is distinct from old.general_registration_covered)) then
    raise exception 'GENERAL_REGISTRATION_COVERAGE_VIA_RPC';
  end if;
  -- An event UPI may never equal the dedicated General Registration UPI.
  if new.upi_id is not null and btrim(new.upi_id) <> '' then
    select upi_id into v_gr_upi from public.general_registration_settings where id = 1;
    if v_gr_upi is not null and lower(btrim(new.upi_id)) = lower(v_gr_upi) then
      raise exception 'EVENT_UPI_MATCHES_GENERAL_REGISTRATION_UPI';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.guard_event_general_registration() from public, anon, authenticated;
drop trigger if exists trg_guard_event_general_registration on public.events;
create trigger trg_guard_event_general_registration
  before insert or update on public.events
  for each row execute function public.guard_event_general_registration();

-- The GR UPI must be dedicated: never equal to any event's UPI id.
create or replace function public.guard_general_registration_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.upi_id is not null and exists (
       select 1 from public.events
       where upi_id is not null and lower(btrim(upi_id)) = lower(new.upi_id)) then
    raise exception 'GENERAL_REGISTRATION_UPI_NOT_DEDICATED';
  end if;
  return new;
end $$;
revoke execute on function public.guard_general_registration_settings() from public, anon, authenticated;
drop trigger if exists trg_guard_general_registration_settings on public.general_registration_settings;
create trigger trg_guard_general_registration_settings
  before insert or update on public.general_registration_settings
  for each row execute function public.guard_general_registration_settings();

-- ── re-shipped pricing / registration / payment functions ───────────────────
create or replace function public.event_offer_price(
  p_profile uuid, p_event_id uuid, p_team_size integer default 1
) returns table (list_price integer, discount integer, amount integer, source_event_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  v_event public.events;
  v_list int;
  v_best int := 0;
  v_src uuid;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then
    return;
  end if;
  v_list := case when v_event.team_enabled and coalesce(p_team_size, 1) >= 2
                 then v_event.team_fee else v_event.registration_fee end;

  if v_list > 0 and p_profile is not null then
    select o.discount_amount, o.source_event_id into v_best, v_src
    from public.event_offers o
    where o.target_event_id = p_event_id
      and o.enabled
      and o.source_event_id <> p_event_id
      and exists (
        select 1 from public.registrations r
        where r.profile_id = p_profile
          and r.event_id = o.source_event_id
          and r.registration_status = 'confirmed'
          and r.payment_status = 'verified'
      )
    order by o.discount_amount desc, o.source_event_id
    limit 1;
    v_best := coalesce(v_best, 0);
  end if;

  -- General Registration (0023): a covered event is included, so free, for a
  -- participant whose General Registration payment is verified.
  if v_event.general_registration_covered and v_list > 0
     and public.is_general_registered(p_profile) then
    v_best := v_list;
    v_src := null;
  end if;

  list_price := v_list;
  discount := least(v_best, v_list);
  amount := v_list - least(v_best, v_list);
  source_event_id := case when least(v_best, v_list) > 0 then v_src else null end;
  return next;
end $$;

create or replace function public.register_for_event(p_event_id uuid)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_event public.events;
  v_reg public.registrations;
  v_existing public.registrations;
  v_reusable boolean;
  v_price record;
  v_amount int;
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
  -- General Registration (0023): covered events are only reachable through it.
  if v_event.general_registration_covered and not public.is_general_registered(v_uid) then
    raise exception 'GENERAL_REGISTRATION_REQUIRED';
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

  select * into v_price from public.event_offer_price(v_uid, p_event_id, 1);
  v_amount := v_price.amount;
  v_hold := case when v_amount = 0 then null else now() + interval '72 hours' end;

  if v_existing.id is null then
    insert into public.registrations (
      profile_id, event_id, amount, registration_status, payment_status,
      hold_expires_at, list_price, offer_discount, offer_source_event_id
    ) values (
      v_uid, p_event_id, v_amount,
      (case when v_amount = 0 then 'confirmed' else 'pending' end)::registration_status,
      (case when v_amount = 0 then 'verified'  else 'unpaid'  end)::payment_status,
      v_hold, v_price.list_price, v_price.discount, v_price.source_event_id
    )
    returning * into v_reg;
  else
    update public.registrations set
      amount = v_amount,
      list_price = v_price.list_price,
      offer_discount = v_price.discount,
      offer_source_event_id = v_price.source_event_id,
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
  v_price record;
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

  -- General Registration (0023): every member of a team for a covered event
  -- must hold a verified General Registration (no free riders, no payment path).
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
  ) then
    raise exception 'MEMBER_ALREADY_REGISTERED';
  end if;

  if v_event.max_participants is not null
     and public.event_seats_taken(p_event_id) + v_size > v_event.max_participants then
    raise exception 'EVENT_FULL';
  end if;

  -- Lone participant: individual fee; real team: flat team fee. The head's
  -- best offer applies to that price (same rule as solo registration).
  select * into v_price from public.event_offer_price(v_uid, p_event_id, v_size);
  v_total := v_price.amount;
  v_hold := case when v_total = 0 then null else now() + interval '72 hours' end;
  v_rs := (case when v_total = 0 then 'confirmed' else 'pending' end)::registration_status;
  v_ps := (case when v_total = 0 then 'verified'  else 'unpaid'  end)::payment_status;

  insert into public.teams (event_id, head_profile_id)
  values (p_event_id, v_uid)
  returning id into v_team_id;

  foreach v_mid in array (array[v_uid] || array_remove(v_ids, v_uid)) loop
    v_is_head := (v_mid = v_uid);
    v_existing := null;
    select * into v_existing from public.registrations
    where profile_id = v_mid and event_id = p_event_id;

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
      values (v_row.id, v_uid, 'intent_refreshed', v_existing.payment_status, v_row.payment_status,
              'Previous ' || v_existing.registration_status::text || ' intent reused for a new team');
    end if;

    if v_is_head then
      v_reg := v_row;
    end if;
  end loop;

  return v_reg;
end $$;

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
  v_existing_gr uuid;
  v_claimed boolean;
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
  -- Covered events are paid through General Registration, never individually.
  if v_event.general_registration_covered then
    raise exception 'GENERAL_REGISTRATION_REQUIRED';
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

  -- Is this transaction id already claimed by a DIFFERENT payment — another
  -- registration or a General Registration (global claim table, 0023)?
  select c.registration_id, c.general_registration_id, true
    into v_existing, v_existing_gr, v_claimed
  from public.payment_utr_claims c
  where c.utr = v_txn and c.registration_id is distinct from p_registration_id;

  if coalesce(v_claimed, false) then
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
            case when v_existing is not null
                 then 'Transaction id already used by registration ' || v_existing::text
                 else 'Transaction id already used by general registration ' || v_existing_gr::text end);
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

revoke all on function public.event_offer_price(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.register_for_event(uuid) to authenticated;
grant execute on function public.register_team(uuid, uuid[]) to authenticated;

-- ── participant RPCs ────────────────────────────────────────────────────────
-- Creates (or returns) the caller's GR payment intent, freezing fee + UPI.
create or replace function public.start_general_registration()
returns public.general_registrations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_settings public.general_registration_settings;
  v_ns text;
  v_row public.general_registrations;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_profile from public.profiles where id = v_uid for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

  select * into v_row from public.general_registrations where profile_id = v_uid;
  if found then return v_row; end if;   -- resume: frozen terms never change

  if v_profile.approval_status <> 'approved' then raise exception 'NOT_APPROVED'; end if;
  select * into v_settings from public.general_registration_settings where id = 1;
  if not v_settings.enabled or v_settings.upi_id is null or v_settings.fee <= 0 then
    raise exception 'GENERAL_REGISTRATION_CLOSED';
  end if;
  select namespace into v_ns from public.participant_id_allocations where profile_id = v_uid;
  if v_ns is distinct from 'E' then raise exception 'PARTICIPANT_ID_REQUIRED'; end if;

  insert into public.general_registrations (profile_id, amount, upi_id, payee_name)
  values (v_uid, v_settings.fee, v_settings.upi_id, btrim(v_settings.payee_name))
  returning * into v_row;
  insert into public.general_registration_payment_events
    (general_registration_id, profile_id, actor_id, action, to_status, note)
  values (v_row.id, v_uid, v_uid, 'intent_created', 'unpaid',
          'Fee ' || v_row.amount || ' paise to ' || v_row.upi_id);
  return v_row;
end $$;

-- Screenshot (+ OCR) and/or UTR for the caller's GR intent. Same states as
-- event payments: uploaded / under_review / duplicate.
create or replace function public.submit_general_registration_payment(
  p_transaction_id text,
  p_screenshot     text,
  p_ocr_raw        text default null,
  p_ocr_conf       numeric default null
)
returns public.general_registrations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.general_registrations;
  v_from payment_status;
  v_txn text;
  v_reg uuid;
  v_gr uuid;
  v_claimed boolean;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_row from public.general_registrations where profile_id = v_uid for update;
  if not found then raise exception 'GENERAL_REGISTRATION_NOT_STARTED'; end if;
  if v_row.status = 'verified' then raise exception 'ALREADY_PAID'; end if;
  if p_screenshot is not null and position(v_uid::text || '/' in p_screenshot) <> 1 then
    raise exception 'INVALID_SCREENSHOT';
  end if;
  v_from := v_row.status;
  v_txn := nullif(upper(btrim(coalesce(p_transaction_id, ''))), '');
  if v_txn is not null and v_txn !~ '^[A-Z0-9]{6,40}$' then
    raise exception 'INVALID_TRANSACTION_ID';
  end if;

  if v_txn is null then
    update public.general_registrations set
      payment_screenshot = coalesce(p_screenshot, payment_screenshot),
      ocr_raw_text = coalesce(p_ocr_raw, ocr_raw_text),
      ocr_confidence = coalesce(p_ocr_conf, ocr_confidence),
      status = 'uploaded',
      transaction_id = null
    where id = v_row.id returning * into v_row;
    insert into public.general_registration_payment_events
      (general_registration_id, profile_id, actor_id, action, from_status, to_status, note)
    values (v_row.id, v_uid, v_uid, 'screenshot_uploaded', v_from, 'uploaded', null);
    return v_row;
  end if;

  select c.registration_id, c.general_registration_id, true into v_reg, v_gr, v_claimed
  from public.payment_utr_claims c
  where c.utr = v_txn and c.general_registration_id is distinct from v_row.id;

  if not coalesce(v_claimed, false) then
    begin
      update public.general_registrations set
        payment_screenshot = coalesce(p_screenshot, payment_screenshot),
        ocr_raw_text = coalesce(p_ocr_raw, ocr_raw_text),
        ocr_confidence = coalesce(p_ocr_conf, ocr_confidence),
        transaction_id = v_txn,
        status = 'under_review',
        submitted_at = now()
      where id = v_row.id returning * into v_row;
      insert into public.general_registration_payment_events
        (general_registration_id, profile_id, actor_id, action, from_status, to_status, note)
      values (v_row.id, v_uid, v_uid, 'payment_submitted', v_from, 'under_review', null);
      return v_row;
    exception when unique_violation then
      v_claimed := true;   -- lost a concurrent race for this UTR
    end;
  end if;

  update public.general_registrations set
    payment_screenshot = coalesce(p_screenshot, payment_screenshot),
    ocr_raw_text = coalesce(p_ocr_raw, ocr_raw_text),
    ocr_confidence = coalesce(p_ocr_conf, ocr_confidence),
    status = 'duplicate',
    transaction_id = null
  where id = v_row.id returning * into v_row;
  insert into public.general_registration_payment_events
    (general_registration_id, profile_id, actor_id, action, from_status, to_status, note)
  values (v_row.id, v_uid, v_uid, 'duplicate_detected', v_from, 'duplicate',
          case when v_reg is not null then 'Transaction id already used by registration ' || v_reg
               when v_gr is not null then 'Transaction id already used by general registration ' || v_gr
               else 'Transaction id race lost' end);
  return v_row;
end $$;

-- ── admin RPCs (payments scope) ─────────────────────────────────────────────
create or replace function public.admin_set_general_registration_settings(
  p_enabled      boolean,
  p_fee          integer,
  p_upi_id       text,
  p_payee_name   text,
  p_description  text,
  p_instructions text
)
returns public.general_registration_settings
language plpgsql security definer set search_path = public as $$
declare
  v_row public.general_registration_settings;
  v_upi text := nullif(btrim(coalesce(p_upi_id, '')), '');
begin
  if not public.has_admin_scope('payments') then raise exception 'FORBIDDEN'; end if;
  if p_enabled is null or p_fee is null or p_fee < 0 or p_fee > 10000000 then
    raise exception 'INVALID_FEE';
  end if;
  if v_upi is not null and v_upi !~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,255}@[A-Za-z][A-Za-z0-9]{1,63}$' then
    raise exception 'INVALID_UPI_ID';
  end if;
  if p_enabled and (p_fee <= 0 or v_upi is null or btrim(coalesce(p_payee_name, '')) = '') then
    raise exception 'GENERAL_REGISTRATION_INCOMPLETE';
  end if;
  update public.general_registration_settings set
    enabled = p_enabled,
    fee = p_fee,
    upi_id = v_upi,
    payee_name = btrim(coalesce(p_payee_name, '')),
    description = coalesce(p_description, ''),
    instructions = coalesce(p_instructions, ''),
    updated_at = now(),
    updated_by = auth.uid()
  where id = 1
  returning * into v_row;
  return v_row;
end $$;

-- Replaces the covered-event set: exactly p_event_ids are covered afterwards.
create or replace function public.admin_set_general_registration_events(p_event_ids uuid[])
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[] := array(select distinct x from unnest(coalesce(p_event_ids, array[]::uuid[])) x where x is not null);
  v_count int;
begin
  if not public.has_admin_scope('payments') then raise exception 'FORBIDDEN'; end if;
  if exists (select 1 from unnest(v_ids) x where not exists (select 1 from public.events e where e.id = x)) then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if exists (select 1 from public.events e where e.id = any (v_ids) and e.archived_at is not null
             and not e.general_registration_covered) then
    raise exception 'EVENT_ARCHIVED';
  end if;
  if exists (select 1 from public.events c where c.parent_event_id = any (v_ids)) then
    raise exception 'HAS_SUBEVENTS';
  end if;
  update public.events set general_registration_covered = (id = any (v_ids))
  where general_registration_covered is distinct from (id = any (v_ids));
  select count(*) into v_count from public.events where general_registration_covered;
  return v_count;
end $$;

-- Verify (E -> GR conversion, atomic + idempotent) or reject a GR payment.
create or replace function public.admin_review_general_registration(
  p_id     uuid,
  p_status payment_status,
  p_note   text default null
)
returns public.general_registrations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.general_registrations;
  v_from payment_status;
  v_ns text;
  v_prev text;
  v_new text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.has_admin_scope('payments') then raise exception 'FORBIDDEN'; end if;
  if p_status is null or p_status not in ('verified', 'rejected') then
    raise exception 'INVALID_STATUS';
  end if;

  select * into v_row from public.general_registrations where id = p_id for update;
  if not found then raise exception 'GENERAL_REGISTRATION_NOT_FOUND'; end if;
  v_from := v_row.status;

  if v_row.status = 'verified' then
    if p_status = 'verified' then return v_row; end if;      -- idempotent
    raise exception 'GENERAL_REGISTRATION_ALREADY_VERIFIED'; -- no GR -> E path
  end if;

  if p_status = 'rejected' then
    update public.general_registrations set status = 'rejected', review_note = v_note
    where id = p_id returning * into v_row;
    insert into public.general_registration_payment_events
      (general_registration_id, profile_id, actor_id, action, from_status, to_status, note)
    values (p_id, v_row.profile_id, v_uid, 'admin_review', v_from, 'rejected', v_note);
    return v_row;
  end if;

  if v_row.transaction_id is null and v_row.payment_screenshot is null then
    raise exception 'NOTHING_TO_VERIFY';
  end if;

  -- 1. lock the profile and both id namespaces (E before GR, as everywhere)
  perform 1 from public.profiles where id = v_row.profile_id for update;
  perform 1 from public.participant_id_namespaces where namespace in ('E', 'GR')
    order by namespace for update;
  -- 2. the participant must currently own an E id
  select namespace into v_ns from public.participant_id_allocations where profile_id = v_row.profile_id;
  if v_ns is distinct from 'E' then raise exception 'GENERAL_REGISTRATION_REQUIRES_E_ID'; end if;
  -- 3-6. release E (to the reuse pool), allocate GR, profile id + history
  v_prev := public.participant_id_release(v_row.profile_id, 'E', v_uid, 'general registration ' || p_id);
  v_new  := public.participant_id_allocate(v_row.profile_id, 'GR', v_uid, 'general registration ' || p_id);
  -- 7. verify + audit
  update public.general_registrations set
    status = 'verified', verified_at = now(), verified_by = v_uid, review_note = v_note,
    previous_participant_id = v_prev, new_participant_id = v_new
  where id = p_id returning * into v_row;
  insert into public.general_registration_payment_events
    (general_registration_id, profile_id, actor_id, action, from_status, to_status, note,
     previous_participant_id, new_participant_id)
  values (p_id, v_row.profile_id, v_uid, 'admin_review', v_from, 'verified', v_note, v_prev, v_new);
  return v_row;
end $$;

revoke execute on function public.start_general_registration() from public, anon;
revoke execute on function public.submit_general_registration_payment(text, text, text, numeric) from public, anon;
revoke execute on function public.admin_set_general_registration_settings(boolean, integer, text, text, text, text) from public, anon;
revoke execute on function public.admin_set_general_registration_events(uuid[]) from public, anon;
revoke execute on function public.admin_review_general_registration(uuid, payment_status, text) from public, anon;
grant execute on function public.start_general_registration() to authenticated;
grant execute on function public.submit_general_registration_payment(text, text, text, numeric) to authenticated;
grant execute on function public.admin_set_general_registration_settings(boolean, integer, text, text, text, text) to authenticated;
grant execute on function public.admin_set_general_registration_events(uuid[]) to authenticated;
grant execute on function public.admin_review_general_registration(uuid, payment_status, text) to authenticated;

-- ── row-level security ──────────────────────────────────────────────────────
alter table public.general_registration_settings       enable row level security;
alter table public.general_registrations               enable row level security;
alter table public.general_registration_payment_events enable row level security;
alter table public.payment_utr_claims                  enable row level security;

revoke all on public.general_registration_settings, public.general_registrations,
              public.general_registration_payment_events, public.payment_utr_claims
  from public, anon, authenticated;
grant select on public.general_registration_settings to anon, authenticated;
grant select on public.general_registrations, public.general_registration_payment_events,
               public.payment_utr_claims to authenticated;

drop policy if exists gr_settings_read on public.general_registration_settings;
create policy gr_settings_read on public.general_registration_settings for select using (true);

drop policy if exists gr_own_or_payments_read on public.general_registrations;
create policy gr_own_or_payments_read on public.general_registrations
  for select using (profile_id = auth.uid() or public.has_admin_scope('payments'));

drop policy if exists gr_events_own_or_payments_read on public.general_registration_payment_events;
create policy gr_events_own_or_payments_read on public.general_registration_payment_events
  for select using (profile_id = auth.uid() or public.has_admin_scope('payments'));

drop policy if exists utr_claims_payments_read on public.payment_utr_claims;
create policy utr_claims_payments_read on public.payment_utr_claims
  for select using (public.has_admin_scope('payments'));
