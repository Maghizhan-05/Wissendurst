-- ============================================================================
-- WISSENDURST'27 — 0032_team_codes_price_windows
--
-- Pre-analytics restructuring, phase 1 (approved).
--   A. Team registration codes W27/T/0001… — one per team of two or more,
--      allocated the moment a team reaches two members (registration or a
--      roster edit) and never changed afterwards. Existing multi-member teams
--      are backfilled in creation order. A transactional counter (not a
--      sequence) keeps codes gap-free and rollback-safe.
--   B. Timed price adjustments on top of the normal per-size price (0030):
--        early_bird / late_bird — admin date-time window, signed per-person ₹
--        on_spot                — the event's own date in Asia/Kolkata
--      Priority on_spot > late_bird > early_bird > normal. Early and late
--      windows can't overlap. adjustment × team size is added to the normal
--      price (never below ₹0) before offers / General Registration, and the
--      result is frozen when the payment intent is created (as before).
-- Safe to re-run.
-- ============================================================================

-- ── A. team codes ──────────────────────────────────────────────────────────
alter table public.teams add column if not exists code text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'teams_code_format') then
    alter table public.teams add constraint teams_code_format check (code is null or code ~ '^W27/T/[0-9]{4,}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'teams_code_unique') then
    alter table public.teams add constraint teams_code_unique unique (code);
  end if;
end $$;

create table if not exists public.team_code_counter (
  id integer primary key default 1 check (id = 1),
  next_number integer not null default 1 check (next_number >= 1)
);
insert into public.team_code_counter (id) values (1) on conflict do nothing;
alter table public.team_code_counter enable row level security;
revoke all on public.team_code_counter from public, anon, authenticated;

-- Gives the team a code once it has two or more members (idempotent).
create or replace function public.ensure_team_code(p_team_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_n int;
begin
  select code into v_code from public.teams where id = p_team_id for update;
  if not found or v_code is not null then return v_code; end if;
  if (select count(*) from public.registrations where team_id = p_team_id) < 2 then return null; end if;
  update public.team_code_counter set next_number = next_number + 1 where id = 1
  returning next_number - 1 into v_n;
  v_code := 'W27/T/' || lpad(v_n::text, 4, '0');
  update public.teams set code = v_code where id = p_team_id;
  return v_code;
end $$;
revoke execute on function public.ensure_team_code(uuid) from public, anon, authenticated;

create or replace function public.registrations_team_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.team_id is not null then
    perform public.ensure_team_code(new.team_id);
  end if;
  return null;
end $$;
revoke execute on function public.registrations_team_code() from public, anon, authenticated;
drop trigger if exists registrations_team_code on public.registrations;
create trigger registrations_team_code
  after insert or update of team_id on public.registrations
  for each row execute function public.registrations_team_code();

-- Clients never write a code directly.
create or replace function public.guard_team_code()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated')
     and (tg_op = 'INSERT' and new.code is not null or tg_op = 'UPDATE' and new.code is distinct from old.code) then
    raise exception 'TEAM_CODE_READ_ONLY';
  end if;
  return new;
end $$;
drop trigger if exists teams_guard_code on public.teams;
create trigger teams_guard_code before insert or update on public.teams
  for each row execute function public.guard_team_code();

-- Backfill: existing teams of two or more, oldest first.
do $$
declare r record;
begin
  for r in
    select t.id from public.teams t
    where t.code is null and (select count(*) from public.registrations x where x.team_id = t.id) >= 2
    order by t.created_at, t.id
  loop
    perform public.ensure_team_code(r.id);
  end loop;
end $$;

-- ── B. price windows ───────────────────────────────────────────────────────
create table if not exists public.event_pricing_windows (
  event_id   uuid not null references public.events(id) on delete cascade,
  kind       text not null check (kind in ('early_bird', 'late_bird', 'on_spot')),
  starts_at  timestamptz,
  ends_at    timestamptz,
  adjustment integer not null check (adjustment between -100000000 and 100000000 and adjustment % 100 = 0),
  primary key (event_id, kind),
  check (
    (kind = 'on_spot' and starts_at is null and ends_at is null)
    or (kind <> 'on_spot' and starts_at is not null and ends_at is not null and starts_at < ends_at)
  )
);
alter table public.event_pricing_windows enable row level security;
revoke all on public.event_pricing_windows from public, anon, authenticated;
grant select on public.event_pricing_windows to anon, authenticated;
drop policy if exists event_pricing_windows_read on public.event_pricing_windows;
create policy event_pricing_windows_read on public.event_pricing_windows for select using (true);

-- The adjustment in force for an event at a moment (at most one row).
create or replace function public.event_price_window(p_event_id uuid, p_at timestamptz default now())
returns table (kind text, adjustment integer, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select w.kind, w.adjustment,
         case when w.kind = 'on_spot' then ((e.event_date + 1)::timestamp at time zone 'Asia/Kolkata') else w.ends_at end
  from public.event_pricing_windows w
  join public.events e on e.id = w.event_id
  where w.event_id = p_event_id
    and (
      (w.kind = 'on_spot' and e.event_date is not null
         and (p_at at time zone 'Asia/Kolkata')::date = e.event_date)
      or (w.kind <> 'on_spot' and p_at >= w.starts_at and p_at < w.ends_at)
    )
  order by case w.kind when 'on_spot' then 1 when 'late_bird' then 2 else 3 end
  limit 1;
$$;
revoke execute on function public.event_price_window(uuid, timestamptz) from public;
grant execute on function public.event_price_window(uuid, timestamptz) to anon, authenticated;

-- Active adjustments for many events (cards and event pages, signed out too).
create or replace function public.active_price_windows(p_event_ids uuid[])
returns table (event_id uuid, kind text, adjustment integer, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, w.kind, w.adjustment, w.ends_at
  from unnest(coalesce(p_event_ids, array[]::uuid[])) as e(id)
  cross join lateral public.event_price_window(e.id) w;
$$;
revoke execute on function public.active_price_windows(uuid[]) from public;
grant execute on function public.active_price_windows(uuid[]) to anon, authenticated;

-- p_windows: [{kind, starts_at?, ends_at?, adjustment}] — replaces all.
create or replace function public.admin_set_event_price_windows(p_event_id uuid, p_windows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  w jsonb;
  v_kind text;
  v_seen text[] := array[]::text[];
  v_start timestamptz;
  v_end timestamptz;
  v_adj numeric;
  e_start timestamptz; e_end timestamptz; l_start timestamptz; l_end timestamptz;
begin
  if not public.has_admin_scope('events') then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(coalesce(p_windows, '[]')) <> 'array' then raise exception 'INVALID_PRICE_WINDOW'; end if;
  perform pg_advisory_xact_lock(hashtext(p_event_id::text));
  perform 1 from public.events where id = p_event_id for update;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;

  for w in select value from jsonb_array_elements(coalesce(p_windows, '[]')) loop
    v_kind := w->>'kind';
    if v_kind is null or v_kind not in ('early_bird', 'late_bird', 'on_spot') or v_kind = any (v_seen) then
      raise exception 'INVALID_PRICE_WINDOW' using detail = coalesce(v_kind, 'kind');
    end if;
    v_seen := v_seen || v_kind;
    if jsonb_typeof(w->'adjustment') <> 'number' then
      raise exception 'INVALID_PRICE_WINDOW' using detail = v_kind || ' adjustment';
    end if;
    v_adj := (w->>'adjustment')::numeric;
    if v_adj <> trunc(v_adj) or abs(v_adj) > 100000000 or v_adj::bigint % 100 <> 0 then
      raise exception 'INVALID_PRICE_WINDOW' using detail = v_kind || ' adjustment';
    end if;
    if v_kind = 'on_spot' then
      v_start := null; v_end := null;
    else
      begin
        v_start := (w->>'starts_at')::timestamptz;
        v_end := (w->>'ends_at')::timestamptz;
      exception when others then
        raise exception 'INVALID_PRICE_WINDOW' using detail = v_kind || ' dates';
      end;
      if v_start is null or v_end is null or v_start >= v_end then
        raise exception 'INVALID_PRICE_WINDOW' using detail = v_kind || ' dates';
      end if;
      if v_kind = 'early_bird' then e_start := v_start; e_end := v_end; else l_start := v_start; l_end := v_end; end if;
    end if;
  end loop;
  if e_start is not null and l_start is not null and e_start < l_end and l_start < e_end then
    raise exception 'PRICE_WINDOWS_OVERLAP';
  end if;

  delete from public.event_pricing_windows where event_id = p_event_id;
  insert into public.event_pricing_windows (event_id, kind, starts_at, ends_at, adjustment)
  select p_event_id, x->>'kind',
         case when x->>'kind' = 'on_spot' then null else (x->>'starts_at')::timestamptz end,
         case when x->>'kind' = 'on_spot' then null else (x->>'ends_at')::timestamptz end,
         (x->>'adjustment')::int
  from jsonb_array_elements(coalesce(p_windows, '[]')) x;
end $$;
revoke execute on function public.admin_set_event_price_windows(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_event_price_windows(uuid, jsonb) to authenticated;

-- 0030 + the window adjustment (per person × team size).
create or replace function public.event_offer_price(p_profile uuid, p_event_id uuid, p_team_size integer default 1)
returns table(list_price integer, discount integer, amount integer, source_event_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  v_event public.events;
  v_list int;
  v_best int := 0;
  v_src uuid;
  v_size int := greatest(coalesce(p_team_size, 1), 1);
  v_adj int;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then
    return;
  end if;
  if v_event.team_enabled then
    select t.fee into v_list from public.event_team_price_tiers t
     where t.event_id = p_event_id and t.team_size = v_size;
    if v_list is null then
      raise exception 'TEAM_PRICE_MISSING';
    end if;
  else
    v_list := v_event.registration_fee;
    v_size := 1;
  end if;

  -- 0032: early bird / late bird / on spot.
  select w.adjustment into v_adj from public.event_price_window(p_event_id) w;
  v_list := greatest(v_list + coalesce(v_adj, 0) * v_size, 0);

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
