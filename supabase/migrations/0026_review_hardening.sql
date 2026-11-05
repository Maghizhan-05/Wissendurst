-- ============================================================================
-- WISSENDURST'27 — 0026_review_hardening
--
-- Fixes for the final review's confirmed blockers.
--
-- (1)+(2) Event hierarchy / archive boundary
--   * Archive, restore and delete happen only through admin_set_event_archived
--     and admin_delete_event: client roles can no longer write archived_at /
--     archived_by, insert pre-archived events or DELETE events directly.
--   * An archived event's parent can't be changed by client roles (no
--     implicit detaching from its subtree).
--   * Every hierarchy mutation takes one transaction-scoped advisory lock
--     (archive, restore, delete, child insert, reparent). The archive RPC
--     locks FIRST and only then reads the event, so concurrent archive /
--     restore calls serialise and a concurrently created child can't escape.
--
-- (3) Profile photo: set_my_profile_photo now takes a storage object path
--     ("<uid>/<file>") that must exist in the caller's own folder of the
--     profile-images bucket; the app builds the public URL from the
--     configured Supabase origin. No caller-supplied host is stored.
--
-- (4) Dedicated General Registration UPI: the site-default event UPI is now
--     stored in protected configuration (payment_destination_settings), and
--     the database refuses a GR UPI equal to it (and opening GR while it is
--     unknown). The app reads the default from here first.
-- Safe to re-run.
-- ============================================================================

-- ── (1)+(2) one hierarchy lock for every structural change ─────────────────
create or replace function public.lock_event_hierarchy()
returns void language sql volatile set search_path = public as $$
  select pg_advisory_xact_lock(hashtext('wissendurst:event-hierarchy'))
$$;
revoke execute on function public.lock_event_hierarchy() from public, anon, authenticated;

-- Direct client writes may not archive, restore, delete or move archived events.
-- SECURITY INVOKER on purpose: inside the SECURITY DEFINER RPCs current_user
-- is the owner, so only raw Data API writes are refused here.
create or replace function public.guard_event_direct_archive_write()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'EVENT_DELETE_VIA_RPC';
  end if;
  if tg_op = 'INSERT' then
    if new.archived_at is not null or new.archived_by is not null then
      raise exception 'EVENT_ARCHIVE_VIA_RPC';
    end if;
    return new;
  end if;
  if new.archived_at is distinct from old.archived_at
     or new.archived_by is distinct from old.archived_by then
    raise exception 'EVENT_ARCHIVE_VIA_RPC';
  end if;
  if old.archived_at is not null and new.parent_event_id is distinct from old.parent_event_id then
    raise exception 'ARCHIVED_EVENT_HIERARCHY_LOCKED';
  end if;
  return new;
end $$;

drop trigger if exists events_guard_direct_archive_write on public.events;
create trigger events_guard_direct_archive_write
  before insert or update or delete on public.events
  for each row execute function public.guard_event_direct_archive_write();

-- Child insert / reparent: serialise with archive operations, then check.
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
  perform public.lock_event_hierarchy();
  -- Read after the lock (fresh snapshot): sees any archive committed meanwhile.
  if exists (
    select 1 from public.events
    where id = new.parent_event_id and archived_at is not null
  ) then
    raise exception 'PARENT_ARCHIVED';
  end if;
  return new;
end $$;

create or replace function public.admin_delete_event(p_event_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.has_admin_scope('events') then
    raise exception 'FORBIDDEN';
  end if;
  perform public.lock_event_hierarchy();
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'EVENT_NOT_FOUND';
  end if;

  -- Same per-event locks register_for_event / register_team take, stable order.
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
  if p_archived is null then
    raise exception 'INVALID_REQUEST';
  end if;

  -- Lock first, read after: concurrent archive/restore/insert/reparent wait.
  perform public.lock_event_hierarchy();
  for v_id in
    select id from public.event_subtree_ids(p_event_id) as id order by id
  loop
    perform pg_advisory_xact_lock(hashtext(v_id::text));
  end loop;

  select * into v_event from public.events where id = p_event_id for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND';
  end if;

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

grant execute on function public.admin_delete_event(uuid) to authenticated;
grant execute on function public.admin_set_event_archived(uuid, boolean) to authenticated;
revoke execute on function public.admin_delete_event(uuid) from anon;
revoke execute on function public.admin_set_event_archived(uuid, boolean) from anon;

-- ── (3) profile photo: storage path in the caller's own folder ─────────────
drop function if exists public.set_my_profile_photo(text);
create function public.set_my_profile_photo(p_path text)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles;
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_path is not null then
    if char_length(v_path) > 200
       or v_path !~ ('^' || v_uid::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$')
       or position('..' in v_path) > 0 then
      raise exception 'INVALID_PHOTO_PATH';
    end if;
    if not exists (select 1 from storage.objects
                   where bucket_id = 'profile-images' and name = v_path) then
      raise exception 'PHOTO_NOT_UPLOADED';
    end if;
  end if;

  update public.profiles set profile_photo = v_path
  where id = v_uid
  returning * into v_row;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  return v_row;
end $$;
revoke execute on function public.set_my_profile_photo(text) from public, anon;
grant execute on function public.set_my_profile_photo(text) to authenticated;
comment on column public.profiles.profile_photo is
  'Storage object path in the profile-images bucket ("<uid>/<file>"), set via set_my_profile_photo(); the app builds the public URL.';

-- ── (4) protected site-default event UPI ───────────────────────────────────
create table if not exists public.payment_destination_settings (
  id                   integer primary key default 1 check (id = 1),
  default_event_upi_id text check (default_event_upi_id is null
    or default_event_upi_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,255}@[A-Za-z][A-Za-z0-9]{1,63}$'),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.profiles(id) on delete set null
);
insert into public.payment_destination_settings (id) values (1) on conflict (id) do nothing;

alter table public.payment_destination_settings enable row level security;
revoke all on public.payment_destination_settings from public, anon, authenticated;
grant select on public.payment_destination_settings to anon, authenticated;
drop policy if exists payment_destination_settings_read on public.payment_destination_settings;
create policy payment_destination_settings_read on public.payment_destination_settings
  for select using (true);   -- the default UPI is shown on every payment page

-- The default may never equal the dedicated GR UPI ...
create or replace function public.guard_payment_destination_settings()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_gr text;
begin
  select upi_id into v_gr from public.general_registration_settings where id = 1;
  if new.default_event_upi_id is not null and v_gr is not null
     and lower(new.default_event_upi_id) = lower(v_gr) then
    raise exception 'DEFAULT_UPI_MATCHES_GENERAL_REGISTRATION_UPI';
  end if;
  return new;
end $$;
revoke execute on function public.guard_payment_destination_settings() from public, anon, authenticated;
drop trigger if exists trg_guard_payment_destination_settings on public.payment_destination_settings;
create trigger trg_guard_payment_destination_settings
  before insert or update on public.payment_destination_settings
  for each row execute function public.guard_payment_destination_settings();

-- ... and the GR UPI may never equal any event UPI or the default; GR can't
-- be opened while the default is unknown (dedication couldn't be proven).
create or replace function public.guard_general_registration_settings()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_default text;
begin
  if new.upi_id is not null and exists (
       select 1 from public.events
       where upi_id is not null and lower(btrim(upi_id)) = lower(new.upi_id)) then
    raise exception 'GENERAL_REGISTRATION_UPI_NOT_DEDICATED';
  end if;
  select default_event_upi_id into v_default from public.payment_destination_settings where id = 1;
  if new.upi_id is not null and v_default is not null and lower(new.upi_id) = lower(v_default) then
    raise exception 'GENERAL_REGISTRATION_UPI_NOT_DEDICATED';
  end if;
  if new.enabled and v_default is null then
    raise exception 'DEFAULT_EVENT_UPI_NOT_CONFIGURED';
  end if;
  return new;
end $$;

-- Payments admins may update the stored default (validated + guarded above).
create or replace function public.admin_set_default_event_upi(p_upi_id text)
returns public.payment_destination_settings
language plpgsql security definer set search_path = public as $$
declare
  v_row public.payment_destination_settings;
  v_upi text := nullif(btrim(coalesce(p_upi_id, '')), '');
begin
  if not public.has_admin_scope('payments') then raise exception 'FORBIDDEN'; end if;
  if v_upi is null or v_upi !~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,255}@[A-Za-z][A-Za-z0-9]{1,63}$' then
    raise exception 'INVALID_UPI_ID';
  end if;
  update public.payment_destination_settings
     set default_event_upi_id = v_upi, updated_at = now(), updated_by = auth.uid()
   where id = 1
  returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.admin_set_default_event_upi(text) from public, anon;
grant execute on function public.admin_set_default_event_upi(text) to authenticated;
