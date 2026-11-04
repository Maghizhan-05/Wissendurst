-- ============================================================================
-- WISSENDURST'27 — 0016_event_archive
-- Event archiving and history-safe deletion.
--
-- (1) events.archived_at / archived_by: an archived event (and its whole
--     sub-event tree) is hidden from the public, cannot accept registrations,
--     and keeps all of its registration, team and payment history for admins.
-- (2) registrations.event_id and teams.event_id become ON DELETE RESTRICT, so
--     deleting an event can never cascade away registration or financial
--     history — whether through the app, the REST API or a parent cascade.
-- (3) admin_delete_event(): permanent delete ONLY for events whose whole
--     subtree has no registrations or teams. Used events must be archived.
-- (4) admin_set_event_archived(): archive / restore an event subtree,
--     serialised with registration via the same per-event advisory locks.
--     admin_event_ids_with_history(): which events are "used".
-- (5) Guard triggers: no new (or re-activated) registration and no new team
--     on an archived event; no live event under an archived parent.
-- (6) Public read policy: archived events are visible only to admins and to
--     participants who hold a registration in that event's tree (so their
--     dashboard history keeps working).
-- Forward-only and safe to re-run.
-- ============================================================================

-- (1) Archive columns. --------------------------------------------------------
alter table public.events
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid
    references public.profiles(id) on delete set null;

create index if not exists events_archived_at_idx on public.events(archived_at);

-- Helpers (SECURITY DEFINER to avoid recursive RLS). --------------------------

-- The event itself plus every descendant sub-event.
create or replace function public.event_subtree_ids(p_event_id uuid)
returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive down as (
    select id from public.events where id = p_event_id
    union
    select e.id from public.events e join down on e.parent_event_id = down.id
  )
  select id from down;
$$;

-- True when any event in the subtree has registrations (any status) or teams.
create or replace function public.event_has_history(p_event_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.registrations r
    where r.event_id in (select public.event_subtree_ids(p_event_id))
  ) or exists (
    select 1 from public.teams t
    where t.event_id in (select public.event_subtree_ids(p_event_id))
  );
$$;

-- True when the signed-in user holds a registration anywhere in the subtree.
create or replace function public.has_registration_in_event_tree(p_event_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.registrations r
    where r.profile_id = auth.uid()
      and r.event_id in (select public.event_subtree_ids(p_event_id))
  );
$$;

-- (2) History can never be cascaded away by an event delete. -----------------
do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'public.events'::regclass
      and c.conrelid in ('public.registrations'::regclass, 'public.teams'::regclass)
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.registrations
  add constraint registrations_event_id_fkey
  foreign key (event_id) references public.events(id) on delete restrict;

alter table public.teams
  add constraint teams_event_id_fkey
  foreign key (event_id) references public.events(id) on delete restrict;

-- (5) Guard triggers. ---------------------------------------------------------

-- Registrations: block inserts and re-activation of a cancelled row (the
-- register_for_event upsert path) or moving a row onto an archived event.
-- Status/payment updates on existing history stay allowed.
create or replace function public.guard_registration_archived_event()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and new.event_id = old.event_id
     and not (old.registration_status = 'cancelled'
              and new.registration_status <> 'cancelled') then
    return new;
  end if;
  if exists (
    select 1 from public.events
    where id = new.event_id and archived_at is not null
  ) then
    raise exception 'EVENT_ARCHIVED';
  end if;
  return new;
end $$;

drop trigger if exists registrations_guard_archived on public.registrations;
create trigger registrations_guard_archived
  before insert or update on public.registrations
  for each row execute function public.guard_registration_archived_event();

-- Teams: no new team on an archived event.
create or replace function public.guard_team_archived_event()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.events
    where id = new.event_id and archived_at is not null
  ) then
    raise exception 'EVENT_ARCHIVED';
  end if;
  return new;
end $$;

drop trigger if exists teams_guard_archived on public.teams;
create trigger teams_guard_archived
  before insert on public.teams
  for each row execute function public.guard_team_archived_event();

-- Events: an active event cannot be created under / moved under an archived
-- parent (it would otherwise surface publicly without its parent).
create or replace function public.guard_event_archived_parent()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.parent_event_id is null or new.archived_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.parent_event_id is not distinct from old.parent_event_id then
    return new;
  end if;
  if exists (
    select 1 from public.events
    where id = new.parent_event_id and archived_at is not null
  ) then
    raise exception 'PARENT_ARCHIVED';
  end if;
  return new;
end $$;

drop trigger if exists events_guard_archived_parent on public.events;
create trigger events_guard_archived_parent
  before insert or update of parent_event_id on public.events
  for each row execute function public.guard_event_archived_parent();

-- (3) History-safe permanent delete. ------------------------------------------
create or replace function public.admin_delete_event(p_event_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.has_admin_scope('events') then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'EVENT_NOT_FOUND';
  end if;

  -- Same locks register_for_event / register_team take, in a stable order.
  for v_id in
    select id from public.event_subtree_ids(p_event_id) as id order by id
  loop
    perform pg_advisory_xact_lock(hashtext(v_id::text));
  end loop;

  if public.event_has_history(p_event_id) then
    raise exception 'EVENT_HAS_HISTORY';
  end if;

  delete from public.events where id = p_event_id; -- unused sub-events cascade
end $$;

-- (4) Archive / restore an event subtree. -------------------------------------
create or replace function public.admin_set_event_archived(
  p_event_id uuid,
  p_archived boolean
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_event public.events;
begin
  if not public.has_admin_scope('events') then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'EVENT_NOT_FOUND';
  end if;

  for v_id in
    select id from public.event_subtree_ids(p_event_id) as id order by id
  loop
    perform pg_advisory_xact_lock(hashtext(v_id::text));
  end loop;

  if p_archived then
    if v_event.archived_at is not null then
      return; -- already archived
    end if;
    update public.events
       set archived_at = now(),
           archived_by = auth.uid(),
           registration_open = false,
           featured = false
     where id in (select public.event_subtree_ids(p_event_id))
       and archived_at is null;
  else
    if v_event.archived_at is null then
      return; -- already active
    end if;
    if v_event.parent_event_id is not null and exists (
      select 1 from public.events
      where id = v_event.parent_event_id and archived_at is not null
    ) then
      raise exception 'PARENT_ARCHIVED';
    end if;
    -- Restore only what was archived together with this event; sub-events
    -- archived separately earlier stay archived. Registration stays closed
    -- until an admin reopens it.
    update public.events
       set archived_at = null,
           archived_by = null
     where id in (select public.event_subtree_ids(p_event_id))
       and archived_at = v_event.archived_at;
  end if;
end $$;

-- Distinct event ids that carry registration/team history (admin UI hint for
-- "archive vs delete"; one row per event, so it is not capped by API row
-- limits the way selecting every registration would be).
create or replace function public.admin_event_ids_with_history()
returns setof uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
  return query
    select event_id from public.registrations
    union
    select event_id from public.teams;
end $$;

grant execute on function public.admin_event_ids_with_history() to authenticated;
grant execute on function public.admin_delete_event(uuid) to authenticated;
grant execute on function public.admin_set_event_archived(uuid, boolean) to authenticated;

-- (6) Archived events are not public. -----------------------------------------
drop policy if exists events_select_all on public.events;
create policy events_select_all on public.events
  for select using (
    archived_at is null
    or public.is_admin()
    or public.has_registration_in_event_tree(id)
  );
