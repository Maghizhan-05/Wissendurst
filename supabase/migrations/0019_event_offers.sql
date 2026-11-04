-- ============================================================================
-- WISSENDURST'27 — 0019_event_offers
-- Directed Event Offers replace the sibling/ancestor discount.
--
--   * event_offers(source → target, discount_amount paise, enabled).
--     A → D never implies D → A, and the event hierarchy grants nothing.
--   * A participant qualifies for an offer only through a CONFIRMED
--     registration with a VERIFIED payment for the source event.
--   * Several qualifying sources: the single highest discount wins (no
--     stacking), capped at the target price (never negative).
--   * Solo and team registration share one rule (event_offer_price); for a
--     team the head's eligibility is evaluated against the team fee.
--   * The resulting price is frozen on the intent, together with the list
--     price, the discount and the source event that unlocked it.
--   * Existing registrations keep their stored amount.
--   * Legacy events.discount_enabled / discount_amount are retired from all
--     calculations but NOT dropped.
-- Forward-only and safe to re-run.
-- ============================================================================

-- ── Offers table ─────────────────────────────────────────────────────────────
create table if not exists public.event_offers (
  id               uuid primary key default gen_random_uuid(),
  source_event_id  uuid not null references public.events(id) on delete cascade,
  target_event_id  uuid not null references public.events(id) on delete cascade,
  discount_amount  integer not null check (discount_amount > 0 and discount_amount <= 100000000),
  enabled          boolean not null default true,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint event_offers_not_self check (source_event_id <> target_event_id),
  constraint event_offers_unique_pair unique (source_event_id, target_event_id)
);
create index if not exists idx_event_offers_target on public.event_offers(target_event_id) where enabled;

drop trigger if exists trg_event_offers_updated on public.event_offers;
create trigger trg_event_offers_updated before update on public.event_offers
  for each row execute function public.set_updated_at();

alter table public.event_offers enable row level security;
drop policy if exists event_offers_admin_read on public.event_offers;
create policy event_offers_admin_read on public.event_offers
  for select using (public.is_admin());
drop policy if exists event_offers_admin_write on public.event_offers;
create policy event_offers_admin_write on public.event_offers
  for all using (public.has_admin_scope('events'))
  with check (public.has_admin_scope('events'));

-- ── Frozen pricing details on each intent ───────────────────────────────────
alter table public.registrations
  add column if not exists list_price integer check (list_price is null or list_price >= 0),
  add column if not exists offer_discount integer not null default 0 check (offer_discount >= 0),
  add column if not exists offer_source_event_id uuid references public.events(id) on delete set null;

comment on column public.events.discount_enabled is
  'RETIRED (0019): legacy sibling discount flag; no longer used in any calculation.';
comment on column public.events.discount_amount is
  'RETIRED (0019): legacy sibling discount amount; no longer used in any calculation.';

-- ── The one pricing rule ─────────────────────────────────────────────────────
-- Price for p_profile registering p_event_id as a party of p_team_size
-- (1 = solo / team of one). list_price is the event's own price, discount the
-- single best qualifying offer capped at list_price.
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

  list_price := v_list;
  discount := least(v_best, v_list);
  amount := v_list - least(v_best, v_list);
  source_event_id := case when least(v_best, v_list) > 0 then v_src else null end;
  return next;
end $$;

-- Signed-in user's offer-aware prices, for cards / event pages (same rule).
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
  cross join lateral public.event_offer_price(auth.uid(), e.id, 2) t
  where auth.uid() is not null
    and e.id = any (coalesce(p_event_ids, array[]::uuid[]));
$$;

revoke all on function public.event_offer_price(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.my_offer_prices(uuid[]) from public, anon;
grant execute on function public.my_offer_prices(uuid[]) to authenticated;

-- ── Admin editor: replace an event's outgoing offers atomically ─────────────
-- p_offers: [{"target_event_id": uuid, "discount_amount": paise, "enabled": bool}]
create or replace function public.admin_set_event_offers(p_source uuid, p_offers jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb;
  v_target uuid;
  v_amount numeric;
  v_targets uuid[] := array[]::uuid[];
  v_count int := 0;
  v_existing boolean;
begin
  if not public.has_admin_scope('events') then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.events where id = p_source) then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if p_offers is null or jsonb_typeof(p_offers) <> 'array' then
    raise exception 'OFFER_INVALID';
  end if;

  for v_item in select * from jsonb_array_elements(p_offers) loop
    begin
      v_target := (v_item->>'target_event_id')::uuid;
      v_amount := (v_item->>'discount_amount')::numeric;
    exception when others then
      raise exception 'OFFER_INVALID';
    end;
    if v_target is null or v_amount is null then
      raise exception 'OFFER_INVALID';
    end if;
    if v_amount <> trunc(v_amount) or v_amount <= 0 or v_amount > 100000000 then
      raise exception 'OFFER_INVALID_AMOUNT';
    end if;
    if v_target = p_source then
      raise exception 'OFFER_SELF_TARGET';
    end if;
    if v_target = any (v_targets) then
      raise exception 'OFFER_DUPLICATE_TARGET';
    end if;
    if not exists (select 1 from public.events where id = v_target) then
      raise exception 'OFFER_TARGET_NOT_FOUND';
    end if;
    select exists (
      select 1 from public.event_offers
      where source_event_id = p_source and target_event_id = v_target
    ) into v_existing;
    -- New mappings must point at a registrable, non-archived event; an
    -- existing mapping may be kept/edited even if its target changed since.
    if not v_existing then
      if exists (select 1 from public.events where id = v_target and archived_at is not null) then
        raise exception 'OFFER_TARGET_ARCHIVED';
      end if;
      if exists (select 1 from public.events where parent_event_id = v_target) then
        raise exception 'OFFER_TARGET_NOT_REGISTRABLE';
      end if;
    end if;
    v_targets := v_targets || v_target;
  end loop;

  delete from public.event_offers
  where source_event_id = p_source
    and not (target_event_id = any (v_targets));

  for v_item in select * from jsonb_array_elements(p_offers) loop
    insert into public.event_offers (source_event_id, target_event_id, discount_amount, enabled, created_by)
    values (
      p_source,
      (v_item->>'target_event_id')::uuid,
      (v_item->>'discount_amount')::numeric::int,
      coalesce((v_item->>'enabled')::boolean, true),
      auth.uid()
    )
    on conflict (source_event_id, target_event_id) do update
      set discount_amount = excluded.discount_amount,
          enabled = excluded.enabled;
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

revoke all on function public.admin_set_event_offers(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_event_offers(uuid, jsonb) to authenticated;

-- ── Individual registration (0017 body; sibling walk → event_offer_price) ───
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

grant execute on function public.register_for_event(uuid) to authenticated;

-- ── Team registration (0017 body; head's offer against the team price) ──────
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

grant execute on function public.register_team(uuid, uuid[]) to authenticated;
