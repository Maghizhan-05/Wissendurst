-- ============================================================================
-- WISSENDURST'27 — 0024_staff_participant_ids
--
-- Staff get their own participant-ID namespaces:
--   ADMIN     admin/01 … admin/99          (ordinary admins)
--   SUPADMIN  supadmin/01 … supadmin/99    (super admins)
-- alongside E (W27/E/0001…) and GR (W27/GR/0001…). Each namespace has its
-- own prefix, width, counter and lowest-first reusable released pool.
--
-- participant_id_sync_role(profile) moves a profile to the namespace its role
-- implies, in one transaction: release the current id (into its pool), then
-- allocate the lowest available id of the target namespace.
--   user                          -> GR if General Registration is verified, else E
--                                    (only when approved; otherwise no id)
--   admin                         -> ADMIN
--   admin + is_super_admin        -> SUPADMIN
-- A profile already in its target namespace is untouched (no history).
--
-- super_set_admin() now changes role/scopes/super flag AND the id together;
-- any failure (e.g. an exhausted range) rolls the role change back.
--
-- Backfill: existing staff are moved now, in creation order then UUID; their
-- E/GR numbers are released for reuse by future participants. Registrations,
-- payments and teams reference the profile UUID and are untouched.
-- Safe to re-run.
-- ============================================================================

-- ── namespaces: prefix + width per namespace ───────────────────────────────
alter table public.participant_id_namespaces
  add column if not exists width integer not null default 4;

alter table public.participant_id_namespaces drop constraint if exists participant_id_namespaces_namespace_check;
alter table public.participant_id_namespaces drop constraint if exists participant_id_namespaces_known;
alter table public.participant_id_namespaces add constraint participant_id_namespaces_known check (
     (namespace = 'E'        and prefix = 'W27/E/'    and width = 4)
  or (namespace = 'GR'       and prefix = 'W27/GR/'   and width = 4)
  or (namespace = 'ADMIN'    and prefix = 'admin/'    and width = 2)
  or (namespace = 'SUPADMIN' and prefix = 'supadmin/' and width = 2));
alter table public.participant_id_namespaces drop constraint if exists participant_id_namespaces_next_number_check;
alter table public.participant_id_namespaces drop constraint if exists participant_id_namespaces_next_in_range;
alter table public.participant_id_namespaces add constraint participant_id_namespaces_next_in_range
  check (next_number between 1 and (case width when 2 then 100 else 10000 end));

insert into public.participant_id_namespaces (namespace, prefix, width)
values ('ADMIN', 'admin/', 2), ('SUPADMIN', 'supadmin/', 2)
on conflict (namespace) do nothing;

-- ── allocation format per namespace ────────────────────────────────────────
alter table public.participant_id_allocations drop constraint if exists participant_id_allocations_format;
alter table public.participant_id_allocations drop constraint if exists participant_id_allocations_number_check;
alter table public.participant_id_allocations add constraint participant_id_allocations_format check (
  case namespace
    when 'E'        then number between 1 and 9999 and participant_id = 'W27/E/'    || lpad(number::text, 4, '0')
    when 'GR'       then number between 1 and 9999 and participant_id = 'W27/GR/'   || lpad(number::text, 4, '0')
    when 'ADMIN'    then number between 1 and 99   and participant_id = 'admin/'    || lpad(number::text, 2, '0')
    when 'SUPADMIN' then number between 1 and 99   and participant_id = 'supadmin/' || lpad(number::text, 2, '0')
    else false end);

alter table public.participant_id_released drop constraint if exists participant_id_released_in_range;
alter table public.participant_id_released add constraint participant_id_released_in_range
  check (number between 1 and (case when namespace in ('ADMIN', 'SUPADMIN') then 99 else 9999 end));

-- ── allocator / release: any known namespace ───────────────────────────────
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
  if p_namespace is null or p_namespace not in ('E', 'GR', 'ADMIN', 'SUPADMIN') then
    raise exception 'INVALID_PARTICIPANT_ID_NAMESPACE';
  end if;

  -- Lock order everywhere: profile row, then namespace rows by key.
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
    if v_number > (case v_ns.width when 2 then 99 else 9999 end) then
      raise exception 'PARTICIPANT_ID_SPACE_EXHAUSTED' using detail = p_namespace;
    end if;
    update public.participant_id_namespaces
      set next_number = v_number + 1, updated_at = now()
      where namespace = p_namespace;
  end if;

  v_pid := v_ns.prefix || lpad(v_number::text, v_ns.width, '0');
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
  if p_namespace is null or p_namespace not in ('E', 'GR', 'ADMIN', 'SUPADMIN') then
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

-- ── role -> namespace transition (server-only) ─────────────────────────────
create or replace function public.participant_id_sync_role(
  p_profile_id uuid,
  p_actor      uuid default null,
  p_reason     text default null
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_p      public.profiles;
  v_cur    text;
  v_target text;
begin
  if p_profile_id is null then raise exception 'PROFILE_REQUIRED'; end if;
  select * into v_p from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

  v_target := case
    when v_p.role = 'admin' and v_p.is_super_admin then 'SUPADMIN'
    when v_p.role = 'admin' then 'ADMIN'
    when v_p.approval_status <> 'approved' then null      -- ids are minted on approval
    when public.is_general_registered(p_profile_id) then 'GR'
    else 'E' end;

  select namespace into v_cur from public.participant_id_allocations where profile_id = p_profile_id;
  if v_cur is not distinct from v_target then
    return v_p.participant_id;                             -- no-op: no history
  end if;

  -- Lock both namespaces in key order (same global order as every caller).
  perform 1 from public.participant_id_namespaces
    where namespace in (v_cur, v_target) order by namespace for update;

  if v_cur is not null then
    perform public.participant_id_release(p_profile_id, v_cur, p_actor, coalesce(p_reason, 'role change'));
  end if;
  if v_target is null then
    return null;
  end if;
  return public.participant_id_allocate(p_profile_id, v_target, p_actor, coalesce(p_reason, 'role change'));
end $$;

revoke execute on function public.participant_id_allocate(uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.participant_id_release(uuid, text, uuid, text)  from public, anon, authenticated;
revoke execute on function public.participant_id_sync_role(uuid, uuid, text)       from public, anon, authenticated;
grant  execute on function public.participant_id_allocate(uuid, text, uuid, text) to service_role;
grant  execute on function public.participant_id_release(uuid, text, uuid, text)  to service_role;
grant  execute on function public.participant_id_sync_role(uuid, uuid, text)       to service_role;

-- ── super-admin role management: role + id change together ────────────────
create or replace function public.super_set_admin(
  p_user_id  uuid,
  p_role     user_role,
  p_super    boolean,
  p_scopes   text[]
)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare v_row public.profiles;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN'; end if;
  if p_user_id is null or p_role is null then raise exception 'INVALID_REQUEST'; end if;
  if p_user_id = auth.uid() and not (p_role = 'admin' and coalesce(p_super, false)) then
    raise exception 'CANNOT_DEMOTE_SELF';
  end if;

  update public.profiles set
    role = p_role,
    is_super_admin = (p_role = 'admin' and coalesce(p_super, false)),
    admin_scopes = case
      when p_role = 'admin' then coalesce(p_scopes, '{}')
      else '{}' end
  where id = p_user_id;
  if not found then raise exception 'USER_NOT_FOUND'; end if;

  perform public.participant_id_sync_role(p_user_id, auth.uid(), 'role change');

  select * into v_row from public.profiles where id = p_user_id;
  return v_row;
end $$;
revoke execute on function public.super_set_admin(uuid, user_role, boolean, text[]) from public, anon;
grant execute on function public.super_set_admin(uuid, user_role, boolean, text[]) to authenticated;

-- ── approval mints the id the role implies (E/GR for users, staff otherwise) ─
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

  -- First approval mints an id; a profile that already holds one keeps it.
  -- Rejection never releases.
  if p_status = 'approved'
     and not exists (select 1 from public.participant_id_allocations where profile_id = p_user_id) then
    perform public.participant_id_sync_role(p_user_id, auth.uid(), 'approval');
  end if;

  select * into v_row from public.profiles where id = p_user_id;
  return v_row;
end $$;
revoke execute on function public.admin_set_approval(uuid, approval_status) from public, anon;
grant execute on function public.admin_set_approval(uuid, approval_status) to authenticated;

-- ── backfill: move existing staff into staff namespaces ────────────────────
do $$
declare r record;
begin
  for r in
    select id from public.profiles where role = 'admin'
    order by created_at, id
  loop
    perform public.participant_id_sync_role(r.id, null, 'staff id backfill (0024)');
  end loop;

  if exists (select 1 from public.profiles p
             left join public.participant_id_allocations a on a.profile_id = p.id
             where p.participant_id is distinct from a.participant_id) then
    raise exception 'INCONSISTENT_STAFF_BACKFILL: profiles differ from allocations';
  end if;
  if exists (select 1 from public.profiles p join public.participant_id_allocations a on a.profile_id = p.id
             where p.role = 'admin' and a.namespace <> case when p.is_super_admin then 'SUPADMIN' else 'ADMIN' end) then
    raise exception 'INCONSISTENT_STAFF_BACKFILL: staff outside staff namespaces';
  end if;
end $$;
