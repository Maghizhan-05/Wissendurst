-- ============================================================================
-- WISSENDURST'27 — 0021_participant_id_allocator
--
-- Participant IDs move from a bare sequence to an explicit allocator:
--
--   participant_id_namespaces   one row per namespace (E, GR): prefix + the
--                               next never-used number (concurrency-safe
--                               counter, locked FOR UPDATE while allocating)
--   participant_id_allocations  ACTIVE ids: one owner per namespace/number
--                               (PK) and one active id per profile (unique)
--   participant_id_released     numbers explicitly released and reusable
--   participant_id_history      append-only assigned/released/backfilled log
--
-- Formats: W27/E/0001 and W27/GR/0001 (four-digit zero padding, max 9999).
--
-- Rules
--   * Allocation reuses the LOWEST explicitly released number of the
--     namespace first, otherwise takes the fresh counter. Gaps that were never
--     released (e.g. a number skipped by the old sequence) are never reused.
--   * Nothing in this migration releases an id. participant_id_release() is a
--     server-only interface for the Phase 6 E -> GR transition; rejection and
--     account deletion do NOT release (a deleted profile's number stays
--     consumed: its allocation keeps the number with a null owner).
--   * profiles.participant_id must always equal the profile's active
--     allocation (or be null when it has none); a trigger rejects any other
--     write, so the column can only change through the allocator.
--   * allocate/release are SECURITY DEFINER with EXECUTE revoked from
--     public/anon/authenticated; admin_set_approval() calls the allocator.
--   * participant_seq is retired (usage revoked, kept, not dropped).
--
-- Backfill: every existing non-null profiles.participant_id is preserved
-- exactly; the migration aborts on malformed ids, duplicates or any
-- inconsistency between profiles and allocations. Safe to re-run.
-- ============================================================================

-- ── tables ──────────────────────────────────────────────────────────────────
create table if not exists public.participant_id_namespaces (
  namespace   text primary key check (namespace in ('E', 'GR')),
  prefix      text not null,
  next_number integer not null default 1 check (next_number between 1 and 10000),
  updated_at  timestamptz not null default now()
);

create table if not exists public.participant_id_allocations (
  namespace      text not null references public.participant_id_namespaces(namespace),
  number         integer not null check (number between 1 and 9999),
  participant_id text not null unique,
  -- null only after the owning account was deleted: the number stays consumed.
  profile_id     uuid unique references public.profiles(id) on delete set null,
  allocated_at   timestamptz not null default now(),
  allocated_by   uuid,
  primary key (namespace, number),
  constraint participant_id_allocations_format
    check (participant_id = 'W27/' || namespace || '/' || lpad(number::text, 4, '0'))
);

create table if not exists public.participant_id_released (
  namespace   text not null references public.participant_id_namespaces(namespace),
  number      integer not null check (number between 1 and 9999),
  released_at timestamptz not null default now(),
  primary key (namespace, number)
);

create table if not exists public.participant_id_history (
  id             bigint generated always as identity primary key,
  namespace      text not null,
  number         integer not null,
  participant_id text not null,
  profile_id     uuid,            -- no FK: history outlives deleted accounts
  action         text not null check (action in ('assigned', 'released', 'backfilled')),
  actor          uuid,
  reason         text,
  created_at     timestamptz not null default now()
);
create index if not exists participant_id_history_profile_idx
  on public.participant_id_history (profile_id, created_at);
create index if not exists participant_id_history_number_idx
  on public.participant_id_history (namespace, number, created_at);

insert into public.participant_id_namespaces (namespace, prefix)
values ('E', 'W27/E/'), ('GR', 'W27/GR/')
on conflict (namespace) do nothing;

-- ── history is append-only ──────────────────────────────────────────────────
create or replace function public.participant_id_history_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'PARTICIPANT_ID_HISTORY_APPEND_ONLY';
end $$;

drop trigger if exists trg_participant_id_history_immutable on public.participant_id_history;
create trigger trg_participant_id_history_immutable
  before update or delete on public.participant_id_history
  for each row execute function public.participant_id_history_immutable();
drop trigger if exists trg_participant_id_history_no_truncate on public.participant_id_history;
create trigger trg_participant_id_history_no_truncate
  before truncate on public.participant_id_history
  for each statement execute function public.participant_id_history_immutable();

-- ── access: no client writes; signups admins may read ───────────────────────
alter table public.participant_id_namespaces  enable row level security;
alter table public.participant_id_allocations enable row level security;
alter table public.participant_id_released    enable row level security;
alter table public.participant_id_history     enable row level security;

revoke all on public.participant_id_namespaces, public.participant_id_allocations,
              public.participant_id_released, public.participant_id_history
  from public, anon, authenticated;
grant select on public.participant_id_namespaces, public.participant_id_allocations,
               public.participant_id_released, public.participant_id_history
  to authenticated;

drop policy if exists pid_namespaces_admin_read on public.participant_id_namespaces;
create policy pid_namespaces_admin_read on public.participant_id_namespaces
  for select using (public.has_admin_scope('signups'));
drop policy if exists pid_allocations_admin_read on public.participant_id_allocations;
create policy pid_allocations_admin_read on public.participant_id_allocations
  for select using (public.has_admin_scope('signups'));
drop policy if exists pid_released_admin_read on public.participant_id_released;
create policy pid_released_admin_read on public.participant_id_released
  for select using (public.has_admin_scope('signups'));
drop policy if exists pid_history_admin_read on public.participant_id_history;
create policy pid_history_admin_read on public.participant_id_history
  for select using (public.has_admin_scope('signups'));

-- ── profiles.participant_id may only mirror the active allocation ──────────
create or replace function public.guard_profile_participant_id()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_active text;
begin
  if tg_op = 'UPDATE' and new.participant_id is not distinct from old.participant_id then
    return new;
  end if;
  select participant_id into v_active
    from public.participant_id_allocations where profile_id = new.id;
  if new.participant_id is distinct from v_active then
    raise exception 'PARTICIPANT_ID_MANAGED_BY_ALLOCATOR';
  end if;
  return new;
end $$;
revoke execute on function public.guard_profile_participant_id() from public, anon, authenticated;
-- (installed after the backfill below, so the backfill can read profiles freely)

-- ── allocator (server-only) ─────────────────────────────────────────────────
create or replace function public.participant_id_allocate(
  p_profile_id uuid,
  p_namespace  text,
  p_actor      uuid default null,
  p_reason     text default null
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_ns     public.participant_id_namespaces;
  v_cur    public.participant_id_allocations;
  v_number integer;
  v_pid    text;
begin
  if p_profile_id is null then raise exception 'PROFILE_REQUIRED'; end if;
  if p_namespace is null or p_namespace not in ('E', 'GR') then
    raise exception 'INVALID_PARTICIPANT_ID_NAMESPACE';
  end if;

  -- Lock order everywhere: profile row, then namespace row.
  perform 1 from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

  select * into v_cur from public.participant_id_allocations where profile_id = p_profile_id;
  if found then
    if v_cur.namespace = p_namespace then
      return v_cur.participant_id;               -- idempotent
    end if;
    raise exception 'PARTICIPANT_ID_ALREADY_ASSIGNED';
  end if;

  select * into v_ns from public.participant_id_namespaces
    where namespace = p_namespace for update;

  select number into v_number from public.participant_id_released
    where namespace = p_namespace order by number limit 1;
  if found then
    delete from public.participant_id_released
      where namespace = p_namespace and number = v_number;
  else
    v_number := v_ns.next_number;
    if v_number > 9999 then raise exception 'PARTICIPANT_ID_SPACE_EXHAUSTED'; end if;
    update public.participant_id_namespaces
      set next_number = v_number + 1, updated_at = now()
      where namespace = p_namespace;
  end if;

  v_pid := v_ns.prefix || lpad(v_number::text, 4, '0');
  insert into public.participant_id_allocations
    (namespace, number, participant_id, profile_id, allocated_by)
  values (p_namespace, v_number, v_pid, p_profile_id, p_actor);
  insert into public.participant_id_history
    (namespace, number, participant_id, profile_id, action, actor, reason)
  values (p_namespace, v_number, v_pid, p_profile_id, 'assigned', p_actor, p_reason);
  update public.profiles set participant_id = v_pid where id = p_profile_id;
  return v_pid;
end $$;

create or replace function public.participant_id_release(
  p_profile_id uuid,
  p_namespace  text,
  p_actor      uuid default null,
  p_reason     text default null
)
returns text
language plpgsql security definer set search_path = public as $$
declare v_cur public.participant_id_allocations;
begin
  if p_profile_id is null then raise exception 'PROFILE_REQUIRED'; end if;
  if p_namespace is null or p_namespace not in ('E', 'GR') then
    raise exception 'INVALID_PARTICIPANT_ID_NAMESPACE';
  end if;

  perform 1 from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  perform 1 from public.participant_id_namespaces where namespace = p_namespace for update;

  delete from public.participant_id_allocations
    where profile_id = p_profile_id and namespace = p_namespace
    returning * into v_cur;
  if not found then raise exception 'PARTICIPANT_ID_NOT_ASSIGNED'; end if;

  insert into public.participant_id_released (namespace, number)
    values (v_cur.namespace, v_cur.number);
  insert into public.participant_id_history
    (namespace, number, participant_id, profile_id, action, actor, reason)
  values (v_cur.namespace, v_cur.number, v_cur.participant_id, p_profile_id,
          'released', p_actor, p_reason);
  update public.profiles set participant_id = null where id = p_profile_id;
  return v_cur.participant_id;
end $$;

revoke execute on function public.participant_id_allocate(uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.participant_id_release(uuid, text, uuid, text)  from public, anon, authenticated;
grant  execute on function public.participant_id_allocate(uuid, text, uuid, text) to service_role;
grant  execute on function public.participant_id_release(uuid, text, uuid, text)  to service_role;

-- ── backfill current ids (preserved exactly) ───────────────────────────────
do $$
declare
  r       record;
  v_ns    text;
  v_num   integer;
  v_alloc public.participant_id_allocations;
  v_bad   text;
  v_seq   bigint;
begin
  -- Malformed ids abort the migration.
  select string_agg(participant_id, ', ') into v_bad from public.profiles
    where participant_id is not null
      and (participant_id !~ '^W27/(E|GR)/[0-9]{4}$' or right(participant_id, 4) = '0000');
  if v_bad is not null then raise exception 'MALFORMED_PARTICIPANT_IDS: %', v_bad; end if;

  -- Duplicates abort (the unique constraint should already prevent them).
  select string_agg(participant_id, ', ') into v_bad from (
    select participant_id from public.profiles where participant_id is not null
    group by participant_id having count(*) > 1) d;
  if v_bad is not null then raise exception 'DUPLICATE_PARTICIPANT_IDS: %', v_bad; end if;

  for r in select id, participant_id, approved_by, created_at, approved_at
             from public.profiles where participant_id is not null
             order by participant_id
  loop
    v_ns  := split_part(r.participant_id, '/', 2);
    v_num := split_part(r.participant_id, '/', 3)::integer;

    select * into v_alloc from public.participant_id_allocations
      where namespace = v_ns and number = v_num;
    if found then
      if v_alloc.profile_id is distinct from r.id then
        raise exception 'INCONSISTENT_BACKFILL: % is allocated to another owner', r.participant_id;
      end if;
    else
      if exists (select 1 from public.participant_id_allocations where profile_id = r.id) then
        raise exception 'INCONSISTENT_BACKFILL: profile % already holds a different id', r.id;
      end if;
      if exists (select 1 from public.participant_id_released where namespace = v_ns and number = v_num) then
        raise exception 'INCONSISTENT_BACKFILL: % is in the released pool', r.participant_id;
      end if;
      insert into public.participant_id_allocations
        (namespace, number, participant_id, profile_id, allocated_at, allocated_by)
      values (v_ns, v_num, r.participant_id, r.id,
              coalesce(r.approved_at, r.created_at), r.approved_by);
    end if;

    if not exists (select 1 from public.participant_id_history
                   where profile_id = r.id and participant_id = r.participant_id) then
      insert into public.participant_id_history
        (namespace, number, participant_id, profile_id, action, actor, reason, created_at)
      values (v_ns, v_num, r.participant_id, r.id, 'backfilled', r.approved_by,
              'existing id preserved by 0021', coalesce(r.approved_at, r.created_at));
    end if;
  end loop;

  -- Every allocation with an owner must match that owner's profile column.
  select string_agg(a.participant_id, ', ') into v_bad
    from public.participant_id_allocations a
    join public.profiles p on p.id = a.profile_id
    where p.participant_id is distinct from a.participant_id;
  if v_bad is not null then raise exception 'INCONSISTENT_BACKFILL: allocations % differ from profiles', v_bad; end if;

  -- Fresh counters never move backwards and skip every number already used
  -- (allocated, released, or handed out by the retired sequence).
  select case when is_called then last_value else last_value - 1 end
    into v_seq from public.participant_seq;
  update public.participant_id_namespaces n set
    next_number = greatest(
      n.next_number,
      coalesce((select max(number) + 1 from public.participant_id_allocations a where a.namespace = n.namespace), 1),
      coalesce((select max(number) + 1 from public.participant_id_released x where x.namespace = n.namespace), 1),
      case when n.namespace = 'E' then v_seq::integer + 1 else 1 end),
    updated_at = now();
end $$;

drop trigger if exists trg_guard_profile_participant_id on public.profiles;
create trigger trg_guard_profile_participant_id
  before insert or update of participant_id on public.profiles
  for each row execute function public.guard_profile_participant_id();

-- ── approval uses the E allocator (idempotent) ─────────────────────────────
create or replace function public.admin_set_approval(
  p_user_id uuid,
  p_status  approval_status
)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare v_row public.profiles;
begin
  if not public.has_admin_scope('signups') then raise exception 'FORBIDDEN'; end if;
  if p_user_id is null or p_status is null then raise exception 'INVALID_REQUEST'; end if;

  update public.profiles set
    approval_status = p_status,
    approved_by = auth.uid(),
    approved_at = case when p_status = 'approved' then now() else approved_at end
  where id = p_user_id;
  if not found then raise exception 'USER_NOT_FOUND'; end if;

  -- First approval mints an E id; a profile that already holds any active id
  -- (E or GR) keeps it. Rejection never releases.
  if p_status = 'approved'
     and not exists (select 1 from public.participant_id_allocations where profile_id = p_user_id) then
    perform public.participant_id_allocate(p_user_id, 'E', auth.uid(), 'approval');
  end if;

  select * into v_row from public.profiles where id = p_user_id;
  return v_row;
end $$;

revoke execute on function public.admin_set_approval(uuid, approval_status) from public, anon;
grant execute on function public.admin_set_approval(uuid, approval_status) to authenticated;

-- ── retire the old sequence (kept, not dropped) ────────────────────────────
revoke all on sequence public.participant_seq from public, anon, authenticated;
comment on sequence public.participant_seq is
  'RETIRED by 0021: participant ids come from participant_id_allocate(). Kept for history only.';
