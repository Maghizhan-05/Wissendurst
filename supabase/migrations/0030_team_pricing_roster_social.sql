-- ============================================================================
-- WISSENDURST'27 — 0030_team_pricing_roster_social
--
-- Phase 10 (approved D-017).
--   A. Per-team-size pricing: event_team_price_tiers(event_id, team_size, fee)
--      covers sizes 1..team_max of every team event (size 1 = a person on
--      their own). events.registration_fee mirrors the size-1 price;
--      events.team_fee is retired (kept, unused). Team settings and prices
--      change only through admin_set_event_pricing (events scope), atomically.
--      Backfill reproduces today's prices exactly: size 1 = registration_fee,
--      sizes 2..team_max = team_fee. Team size is capped at 10.
--   B. Team name on public.teams.name (1-60 chars, trimmed, no control
--      characters), required for teams of two or more. Existing teams: NULL.
--   C. edit_team_roster: the team head may change teammates and the team name
--      while the registration is unpaid with no payment evidence and a live
--      hold. Removed teammates' registrations are DELETED; added teammates
--      follow the head's existing hold (never extended); the price is
--      recomputed for the new size. Any payment evidence locks both.
--   D. site_settings.social: up to five admin-configured social links
--      (allowlisted platforms, https only, per-platform hosts).
-- Locks: pg_advisory_xact_lock(hashtext(event_id::text)) — the same per-event
-- lock register_team / register_for_event / submit_payment take — then rows.
-- Safe to re-run.
-- ============================================================================

-- ── A. pricing tiers ────────────────────────────────────────────────────────
create table if not exists public.event_team_price_tiers (
  event_id  uuid not null references public.events(id) on delete cascade,
  team_size smallint not null check (team_size between 1 and 10),
  fee       integer not null check (fee between 0 and 100000000),
  primary key (event_id, team_size)
);
alter table public.event_team_price_tiers enable row level security;
revoke all on public.event_team_price_tiers from public, anon, authenticated;
grant select on public.event_team_price_tiers to anon, authenticated;
drop policy if exists event_team_price_tiers_read on public.event_team_price_tiers;
create policy event_team_price_tiers_read on public.event_team_price_tiers for select using (true);

do $$
begin
  if exists (select 1 from public.events where team_min < 1 or team_max > 10 or team_min > team_max) then
    raise exception 'TEAM_SIZE_OUT_OF_RANGE' using detail = 'an event has team_min/team_max outside 1..10';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_team_size_range') then
    alter table public.events add constraint events_team_size_range
      check (team_min >= 1 and team_max <= 10 and team_min <= team_max);
  end if;
end $$;
comment on column public.events.team_fee is 'Retired by 0030 (per-size prices live in event_team_price_tiers). Kept, unused.';

-- Backfill (only events that have no tiers yet): exactly today's prices.
insert into public.event_team_price_tiers (event_id, team_size, fee)
select e.id, s, case when s = 1 then e.registration_fee else e.team_fee end
from public.events e
cross join lateral generate_series(1, e.team_max) s
where e.team_enabled
  and not exists (select 1 from public.event_team_price_tiers t where t.event_id = e.id)
on conflict do nothing;

-- Keep tiers consistent with the event row whatever writes it (the pricing
-- RPC, service role, SQL): sizes are exactly 1..team_max, size 1 equals
-- registration_fee, a missing size is filled from the legacy fields
-- (team_fee), and non-team events have no tiers.
create or replace function public.sync_event_team_price_tiers()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.team_enabled then
    delete from public.event_team_price_tiers where event_id = new.id;
    return null;
  end if;
  delete from public.event_team_price_tiers where event_id = new.id and team_size > new.team_max;
  insert into public.event_team_price_tiers (event_id, team_size, fee)
  select new.id, s, case when s = 1 then new.registration_fee else new.team_fee end
  from generate_series(1, new.team_max) s
  on conflict (event_id, team_size) do nothing;
  update public.event_team_price_tiers set fee = new.registration_fee
   where event_id = new.id and team_size = 1 and fee is distinct from new.registration_fee;
  return null;
end $$;
revoke execute on function public.sync_event_team_price_tiers() from public, anon, authenticated;
drop trigger if exists events_sync_team_price_tiers on public.events;
create trigger events_sync_team_price_tiers
  after insert or update of team_enabled, team_max, registration_fee, team_fee on public.events
  for each row execute function public.sync_event_team_price_tiers();

-- Every team event must now price every size 1..team_max.
do $$
begin
  if exists (
    select 1 from public.events e
    where e.team_enabled
      and (select count(*) from public.event_team_price_tiers t where t.event_id = e.id and t.team_size between 1 and e.team_max) <> e.team_max
  ) then
    raise exception 'TEAM_PRICES_INCOMPLETE';
  end if;
end $$;

-- Direct client writes may not change team settings or the price of a team
-- event (they go through admin_set_event_pricing). SECURITY INVOKER on
-- purpose: inside the definer RPCs current_user is the owner.
create or replace function public.guard_event_direct_pricing_write()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.team_enabled then raise exception 'EVENT_PRICING_VIA_RPC'; end if;
    return new;
  end if;
  if new.team_enabled is distinct from old.team_enabled
     or new.team_min is distinct from old.team_min
     or new.team_max is distinct from old.team_max
     or new.team_fee is distinct from old.team_fee
     or (old.team_enabled and new.registration_fee is distinct from old.registration_fee) then
    raise exception 'EVENT_PRICING_VIA_RPC';
  end if;
  return new;
end $$;
drop trigger if exists events_guard_direct_pricing_write on public.events;
create trigger events_guard_direct_pricing_write
  before insert or update on public.events
  for each row execute function public.guard_event_direct_pricing_write();

-- p_tiers: jsonb array of team_max integer fees in paise; element 1 = solo.
-- team_min only gates registration (TEAM_TOO_SMALL); prices always cover 1..team_max.
create or replace function public.admin_set_event_pricing(
  p_event_id uuid,
  p_registration_fee integer,
  p_team_enabled boolean,
  p_team_min integer,
  p_team_max integer,
  p_tiers jsonb
)
returns public.events
language plpgsql security definer set search_path = public as $$
declare
  v_event public.events;
  v_fee int;
  i int;
begin
  if not public.has_admin_scope('events') then raise exception 'FORBIDDEN'; end if;
  if p_team_enabled is null then raise exception 'INVALID_PRICING'; end if;
  perform pg_advisory_xact_lock(hashtext(p_event_id::text));
  select * into v_event from public.events where id = p_event_id for update;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;

  if not p_team_enabled then
    if p_registration_fee is null or p_registration_fee < 0 or p_registration_fee > 100000000 then
      raise exception 'INVALID_PRICING' using detail = 'registration_fee';
    end if;
    delete from public.event_team_price_tiers where event_id = p_event_id;
    update public.events
       set team_enabled = false, team_min = 1,
           team_max = greatest(1, least(coalesce(p_team_max, team_max), 10)),
           registration_fee = p_registration_fee
     where id = p_event_id
    returning * into v_event;
    return v_event;
  end if;

  if p_team_max is null or p_team_max < 1 or p_team_max > 10 then
    raise exception 'INVALID_PRICING' using detail = 'team_max';
  end if;
  if p_team_min is null or p_team_min < 1 or p_team_min > p_team_max then
    raise exception 'INVALID_PRICING' using detail = 'team_min';
  end if;
  if jsonb_typeof(p_tiers) is distinct from 'array' or jsonb_array_length(p_tiers) <> p_team_max then
    raise exception 'INVALID_PRICING' using detail = 'tiers';
  end if;
  for i in 0 .. p_team_max - 1 loop
    if jsonb_typeof(p_tiers->i) <> 'number' or (p_tiers->>i) !~ '^[0-9]+$'
       or (p_tiers->>i)::numeric > 100000000 then
      raise exception 'INVALID_PRICING' using detail = 'tier ' || (i + 1);
    end if;
  end loop;

  delete from public.event_team_price_tiers where event_id = p_event_id;
  insert into public.event_team_price_tiers (event_id, team_size, fee)
  select p_event_id, (o)::smallint, (v #>> '{}')::int
  from jsonb_array_elements(p_tiers) with ordinality x(v, o);
  v_fee := (p_tiers->>0)::int;
  update public.events
     set team_enabled = true, team_min = p_team_min, team_max = p_team_max, registration_fee = v_fee
   where id = p_event_id
  returning * into v_event;
  return v_event;
end $$;
revoke execute on function public.admin_set_event_pricing(uuid, integer, boolean, integer, integer, jsonb) from public, anon;
grant execute on function public.admin_set_event_pricing(uuid, integer, boolean, integer, integer, jsonb) to authenticated;

-- Price list: team events use the tier for the exact size; others the fee.
create or replace function public.event_offer_price(p_profile uuid, p_event_id uuid, p_team_size integer default 1)
returns table(list_price integer, discount integer, amount integer, source_event_id uuid)
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
  if v_event.team_enabled then
    select t.fee into v_list from public.event_team_price_tiers t
     where t.event_id = p_event_id and t.team_size = greatest(coalesce(p_team_size, 1), 1);
    if v_list is null then
      raise exception 'TEAM_PRICE_MISSING';
    end if;
  else
    v_list := v_event.registration_fee;
  end if;

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

-- Card/page previews (0019 signature kept). The "team" column prices a team
-- of two, or of one when the event's max team size is 1.
create or replace function public.my_offer_prices(p_event_ids uuid[])
returns table (
  event_id uuid,
  solo_list integer, solo_discount integer, solo_amount integer,
  team_list integer, team_discount integer, team_amount integer
)
language sql stable security definer set search_path = public as $$
  select e.id,
         s.list_price, s.discount, s.amount,
         t.list_price, t.discount, t.amount
  from public.events e
  cross join lateral public.event_offer_price(auth.uid(), e.id, 1) s
  cross join lateral public.event_offer_price(auth.uid(), e.id,
             case when e.team_enabled then least(2, e.team_max) else 2 end) t
  where auth.uid() is not null
    and e.id = any (coalesce(p_event_ids, array[]::uuid[]));
$$;
revoke all on function public.my_offer_prices(uuid[]) from public, anon;
grant execute on function public.my_offer_prices(uuid[]) to authenticated;

-- The signed-in head's price for every size of one team event (the exact
-- rule register_team / edit_team_roster freeze).
create or replace function public.my_team_prices(p_event_id uuid)
returns table (team_size integer, list_price integer, discount integer, amount integer)
language sql stable security definer set search_path = public as $$
  select t.team_size::int, p.list_price, p.discount, p.amount
  from public.event_team_price_tiers t
  join public.events e on e.id = t.event_id and e.team_enabled
  cross join lateral public.event_offer_price(auth.uid(), t.event_id, t.team_size) p
  where auth.uid() is not null and t.event_id = p_event_id
  order by t.team_size;
$$;
revoke all on function public.my_team_prices(uuid) from public, anon;
grant execute on function public.my_team_prices(uuid) to authenticated;

-- ── B. team name ───────────────────────────────────────────────────────────
alter table public.teams add column if not exists name text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'teams_name_valid') then
    alter table public.teams add constraint teams_name_valid
      check (name is null or (name = btrim(name) and char_length(name) between 1 and 60 and name !~ '[[:cntrl:]]'));
  end if;
end $$;

-- Normalised team name, or an error code.
create or replace function public.team_name_normalized(p_name text)
returns text language plpgsql immutable set search_path = public as $$
declare v text := btrim(coalesce(p_name, ''));
begin
  if v = '' then raise exception 'TEAM_NAME_REQUIRED'; end if;
  if char_length(v) > 60 or v ~ '[[:cntrl:]]' then raise exception 'TEAM_NAME_INVALID'; end if;
  return v;
end $$;
revoke execute on function public.team_name_normalized(text) from public, anon, authenticated;

-- Computed field for embeds: team:teams!team_id(name, member_count). Visible
-- only where the team row itself is (teams RLS); members see their team size.
create or replace function public.member_count(t public.teams)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.registrations r where r.team_id = t.id;
$$;
revoke execute on function public.member_count(public.teams) from public, anon;
grant execute on function public.member_count(public.teams) to authenticated, service_role;

drop function if exists public.register_team(uuid, uuid[]);
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
  ) then
    raise exception 'MEMBER_ALREADY_REGISTERED';
  end if;

  if v_event.max_participants is not null
     and public.event_seats_taken(p_event_id) + v_size > v_event.max_participants then
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
revoke execute on function public.register_team(uuid, uuid[], text) from public, anon;
grant execute on function public.register_team(uuid, uuid[], text) to authenticated;

-- ── C. pre-payment roster editing ──────────────────────────────────────────
-- Teammate lookup for an edit: a member already on THIS team doesn't block.
create or replace function public.registration_blocks_new(p_profile_id uuid, p_event_id uuid, p_exclude_team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.registrations r
    cross join lateral public.registration_effective_state(r.id) s
    where r.profile_id = p_profile_id and r.event_id = p_event_id
      and not s.reusable
      and r.team_id is distinct from p_exclude_team_id
  );
$$;
revoke all on function public.registration_blocks_new(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.registration_blocks_new(uuid, uuid, uuid) to service_role;

-- True when the head registration may still change roster/name: pending and
-- unpaid, no screenshot / UTR / duplicate link / UTR claim, hold still live.
create or replace function public.team_roster_editable(p_head public.registrations)
returns boolean language sql stable security definer set search_path = public as $$
  select p_head.is_team_head
     and p_head.team_id is not null
     and p_head.registration_status = 'pending'
     and p_head.payment_status = 'unpaid'
     and p_head.payment_screenshot is null
     and p_head.transaction_id is null
     and p_head.duplicate_of is null
     and p_head.hold_expires_at is not null
     and p_head.hold_expires_at > now()
     and not exists (select 1 from public.payment_utr_claims c where c.registration_id = p_head.id);
$$;
revoke execute on function public.team_roster_editable(public.registrations) from public, anon, authenticated;

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
    ) then
      raise exception 'MEMBER_ALREADY_REGISTERED';
    end if;
  end if;
  if v_event.general_registration_covered and exists (
    select 1 from unnest(v_ids) mid where not public.is_general_registered(mid)
  ) then
    raise exception 'GENERAL_REGISTRATION_REQUIRED';
  end if;
  -- The team's own seats are already counted; only growth needs room.
  if v_event.max_participants is not null and v_size > v_old_size
     and public.event_seats_taken(v_head.event_id) - v_old_size + v_size > v_event.max_participants then
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
    select * into v_existing from public.registrations where profile_id = v_mid and event_id = v_head.event_id;
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
      values (v_existing.id, v_uid, 'intent_refreshed', v_existing.payment_status, v_ps,
              'Previous ' || v_existing.registration_status::text || ' intent reused when added to a team');
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

-- ── D. social links ────────────────────────────────────────────────────────
-- { "links": [ { "platform", "url", "enabled" } ] }  (0..5). Returns null when
-- valid, otherwise an error code. Mirrors lib/content/social.ts.
create or replace function public.site_social_links_error(p jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare
  l jsonb;
  k text;
  v_host text;
  v_url text;
  v_platform text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'NOT_OBJECT'; end if;
  if p = '{}'::jsonb then return null; end if;
  for k in select jsonb_object_keys(p) loop
    if k <> 'links' then return 'UNKNOWN_KEY'; end if;
  end loop;
  if jsonb_typeof(p->'links') <> 'array' then return 'LINKS_NOT_ARRAY'; end if;
  if jsonb_array_length(p->'links') > 5 then return 'TOO_MANY_LINKS'; end if;
  for l in select value from jsonb_array_elements(p->'links') loop
    if jsonb_typeof(l) <> 'object' then return 'LINK_NOT_OBJECT'; end if;
    for k in select jsonb_object_keys(l) loop
      if k not in ('platform', 'url', 'enabled') then return 'UNKNOWN_LINK_KEY'; end if;
    end loop;
    if jsonb_typeof(l->'enabled') is distinct from 'boolean' then return 'INVALID_ENABLED'; end if;
    v_platform := l->>'platform';
    if jsonb_typeof(l->'platform') is distinct from 'string' or v_platform not in
       ('instagram','facebook','x','youtube','linkedin','whatsapp','telegram','threads','website') then
      return 'INVALID_PLATFORM';
    end if;
    v_url := l->>'url';
    if jsonb_typeof(l->'url') is distinct from 'string' or char_length(v_url) > 300
       or v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^[:space:]<>"''`]*)?$' then
      return 'INVALID_URL';
    end if;
    v_host := lower(substring(v_url from '^https://([^/:]+)'));
    v_host := regexp_replace(v_host, '^www\.', '');
    if not (
      (v_platform = 'instagram' and v_host in ('instagram.com')) or
      (v_platform = 'facebook'  and v_host in ('facebook.com', 'fb.com', 'm.facebook.com')) or
      (v_platform = 'x'         and v_host in ('x.com', 'twitter.com')) or
      (v_platform = 'youtube'   and v_host in ('youtube.com', 'youtu.be', 'm.youtube.com')) or
      (v_platform = 'linkedin'  and v_host in ('linkedin.com')) or
      (v_platform = 'whatsapp'  and v_host in ('wa.me', 'whatsapp.com', 'chat.whatsapp.com')) or
      (v_platform = 'telegram'  and v_host in ('t.me', 'telegram.me')) or
      (v_platform = 'threads'   and v_host in ('threads.net', 'threads.com')) or
      (v_platform = 'website'   and v_host ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$')
    ) then
      return 'HOST_NOT_ALLOWED';
    end if;
  end loop;
  return null;
end $$;

alter table public.site_settings add column if not exists social jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'site_settings_social_valid') then
    alter table public.site_settings add constraint site_settings_social_valid
      check (public.site_social_links_error(social) is null);
  end if;
end $$;
