-- ============================================================================
-- WISSENDURST'27 — 0007_approvals_and_admin_scopes
-- (1) Signup approval gate + ID-card verification.
-- (2) Scoped admin permissions: signups / events / payments / content, plus a
--     super admin who has everything.
-- ============================================================================

do $$ begin
  create type approval_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

alter table public.profiles
  add column if not exists approval_status approval_status not null default 'pending',
  add column if not exists id_card_path   text,
  add column if not exists approved_by     uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at     timestamptz,
  add column if not exists is_super_admin  boolean not null default false,
  add column if not exists admin_scopes    text[] not null default '{}';

-- Nobody who already exists should be locked out: approve all current users…
update public.profiles set approval_status = 'approved'
  where approval_status = 'pending';

-- …and promote existing admins to super admin with every scope.
update public.profiles
  set is_super_admin = true,
      admin_scopes = array['signups','events','payments','content']
  where role = 'admin';

-- ── permission helpers (SECURITY DEFINER to avoid recursive RLS) ─────────────
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_super_admin
  );
$$;

create or replace function public.has_admin_scope(p_scope text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
      and (is_super_admin or p_scope = any (admin_scopes))
  );
$$;

-- ── tighten table policies to scopes ────────────────────────────────────────
drop policy if exists events_admin_write on public.events;
create policy events_admin_write on public.events
  for all using (public.has_admin_scope('events'))
  with check (public.has_admin_scope('events'));

drop policy if exists reg_admin_write on public.registrations;
create policy reg_admin_write on public.registrations
  for all using (public.has_admin_scope('events') or public.has_admin_scope('payments'))
  with check (public.has_admin_scope('events') or public.has_admin_scope('payments'));

drop policy if exists site_settings_admin_write on public.site_settings;
create policy site_settings_admin_write on public.site_settings
  for all using (public.has_admin_scope('content'))
  with check (public.has_admin_scope('content'));

-- Admins no longer mutate profiles directly; they use the RPCs below.
drop policy if exists profiles_admin_update on public.profiles;

-- ── approval RPC (signups scope) ────────────────────────────────────────────
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
    approved_at = case when p_status = 'approved' then now() else approved_at end
  where id = p_user_id
  returning * into v_row;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  return v_row;
end $$;

-- ── super-admin: manage staff roles & scopes ────────────────────────────────
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
  if p_user_id = auth.uid() and not p_super then
    raise exception 'CANNOT_DEMOTE_SELF';
  end if;

  update public.profiles set
    role = p_role,
    is_super_admin = (p_role = 'admin' and p_super),
    admin_scopes = case
      when p_role = 'admin' then coalesce(p_scopes, '{}')
      else '{}' end
  where id = p_user_id
  returning * into v_row;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  return v_row;
end $$;

-- payments RPC now requires the payments scope
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

  update public.registrations set
    payment_status = p_status,
    registration_status = case
      when p_status = 'verified' then 'confirmed'::registration_status
      when p_status = 'rejected' then 'rejected'::registration_status
      else registration_status end,
    verified_at = case when p_status = 'verified' then now() else verified_at end,
    verified_by = case when p_status = 'verified' then v_uid else verified_by end
  where id = p_registration_id
  returning * into v_reg;

  insert into public.payment_events(registration_id, actor_id, action, from_status, to_status, note)
  values (p_registration_id, v_uid, 'admin_review', v_from, p_status, p_note);
  return v_reg;
end $$;

grant execute on function public.admin_set_approval(uuid, approval_status) to authenticated;
grant execute on function public.super_set_admin(uuid, user_role, boolean, text[]) to authenticated;

-- ── id-cards bucket (PRIVATE) ───────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('id-cards', 'id-cards', false)
on conflict (id) do nothing;

drop policy if exists "id cards owner insert" on storage.objects;
create policy "id cards owner insert" on storage.objects
  for insert with check (
    bucket_id = 'id-cards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "id cards admin read" on storage.objects;
create policy "id cards admin read" on storage.objects
  for select using (
    bucket_id = 'id-cards'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.has_admin_scope('signups')
    )
  );
