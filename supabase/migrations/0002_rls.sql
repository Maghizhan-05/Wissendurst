-- ============================================================================
-- WISSENDURST'27 — 0002_rls
-- Row Level Security. Security is enforced HERE, not in the UI.
-- ============================================================================

-- Admin check that bypasses RLS to avoid recursive policy evaluation.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

alter table public.profiles       enable row level security;
alter table public.events         enable row level security;
alter table public.registrations  enable row level security;
alter table public.payment_events enable row level security;

-- ── profiles ────────────────────────────────────────────────────────────────
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));
  -- users may edit their profile but NOT escalate their own role.

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- Inserts happen via the handle_new_user() trigger (security definer); no
-- direct client insert policy is granted.

-- ── events ──────────────────────────────────────────────────────────────────
drop policy if exists events_select_all on public.events;
create policy events_select_all on public.events
  for select using (true); -- events are public, even for signed-out visitors

drop policy if exists events_admin_write on public.events;
create policy events_admin_write on public.events
  for all using (public.is_admin()) with check (public.is_admin());

-- ── registrations ───────────────────────────────────────────────────────────
drop policy if exists reg_select_own on public.registrations;
create policy reg_select_own on public.registrations
  for select using (profile_id = auth.uid() or public.is_admin());

-- Direct inserts/updates by users go through SECURITY DEFINER RPCs
-- (register_for_event, submit_payment) so capacity and duplicate rules are
-- enforced centrally. Only admins get a blanket write policy here.
drop policy if exists reg_admin_write on public.registrations;
create policy reg_admin_write on public.registrations
  for all using (public.is_admin()) with check (public.is_admin());

-- NOTE: users are deliberately NOT granted a direct UPDATE policy. A blanket
-- "update your own registration" policy would let a user set
-- payment_status = 'verified' themselves. Cancellation goes through the
-- cancel_registration() SECURITY DEFINER RPC, which only flips the status.
drop policy if exists reg_cancel_own on public.registrations;

-- ── payment_events ──────────────────────────────────────────────────────────
drop policy if exists pe_select_related on public.payment_events;
create policy pe_select_related on public.payment_events
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.registrations r
      where r.id = registration_id and r.profile_id = auth.uid()
    )
  );

drop policy if exists pe_admin_write on public.payment_events;
create policy pe_admin_write on public.payment_events
  for all using (public.is_admin()) with check (public.is_admin());
