-- ============================================================================
-- WISSENDRUST'27 — 0012_team_registration
-- Team registration for events that opt in. The team head enters teammates by
-- their participant id (W27/E/…); the backend groups everyone into a team, one
-- registration per member sharing a team_id, and the head pays the combined
-- fee. Verifying the head's payment confirms the whole team. Members can't be
-- double-registered for the same event.
-- ============================================================================

alter table public.events
  add column if not exists team_enabled boolean not null default false,
  add column if not exists team_min int not null default 2,
  add column if not exists team_max int not null default 4;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  head_profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists teams_event_idx on public.teams(event_id);
create index if not exists teams_head_idx on public.teams(head_profile_id);

alter table public.registrations
  add column if not exists team_id uuid references public.teams(id) on delete set null,
  add column if not exists is_team_head boolean not null default false;
create index if not exists registrations_team_idx on public.registrations(team_id);

-- ── RLS: members and admins can read their teams; writes go through the RPC ──
alter table public.teams enable row level security;

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams
  for select using (
    head_profile_id = auth.uid()
    or exists (
      select 1 from public.registrations r
      where r.team_id = teams.id and r.profile_id = auth.uid()
    )
    or public.has_admin_scope('events')
    or public.has_admin_scope('payments')
  );

-- ── Team registration RPC (SECURITY DEFINER: the head writes rows for mates) ─
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
  v_taken int;
  v_total int;
  v_team_id uuid;
  v_reg public.registrations;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'EVENT_NOT_FOUND';
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

  -- Distinct member set, always including the head.
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

  -- Every member must be an approved participant.
  if exists (
    select 1 from unnest(v_ids) as mid
    where not exists (
      select 1 from public.profiles p
      where p.id = mid and p.approval_status = 'approved'
    )
  ) then
    raise exception 'MEMBER_NOT_APPROVED';
  end if;

  -- Nobody may already hold an active registration for this event.
  if exists (
    select 1 from public.registrations r
    where r.event_id = p_event_id
      and r.registration_status <> 'cancelled'
      and r.profile_id = any (v_ids)
  ) then
    raise exception 'MEMBER_ALREADY_REGISTERED';
  end if;

  if v_event.max_participants is not null then
    select count(*) into v_taken from public.registrations
    where event_id = p_event_id and registration_status in ('pending','confirmed');
    if v_taken + v_size > v_event.max_participants then
      raise exception 'EVENT_FULL';
    end if;
  end if;

  insert into public.teams (event_id, head_profile_id)
  values (p_event_id, v_uid)
  returning id into v_team_id;

  v_total := v_event.registration_fee * v_size;

  -- Head registration carries the combined fee and is the payable one.
  insert into public.registrations (
    profile_id, event_id, amount, registration_status, payment_status,
    team_id, is_team_head
  ) values (
    v_uid, p_event_id, v_total,
    (case when v_total = 0 then 'confirmed' else 'pending' end)::registration_status,
    (case when v_total = 0 then 'verified'  else 'unpaid'  end)::payment_status,
    v_team_id, true
  )
  returning * into v_reg;

  -- Teammates ride on the team: zero individual amount, confirmed when the
  -- head's payment is verified (see admin_set_payment_status cascade below).
  insert into public.registrations (
    profile_id, event_id, amount, registration_status, payment_status,
    team_id, is_team_head
  )
  select mid, p_event_id, 0,
    (case when v_total = 0 then 'confirmed' else 'pending' end)::registration_status,
    (case when v_total = 0 then 'verified'  else 'unpaid'  end)::payment_status,
    v_team_id, false
  from unnest(v_ids) as mid
  where mid <> v_uid;

  return v_reg;
end $$;

grant execute on function public.register_team(uuid, uuid[]) to authenticated;

-- ── Payment verification cascades across the whole team ─────────────────────
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

  -- Apply the same outcome to the rest of the team.
  if v_reg.team_id is not null then
    update public.registrations set
      payment_status = p_status,
      registration_status = case
        when p_status = 'verified' then 'confirmed'::registration_status
        when p_status = 'rejected' then 'rejected'::registration_status
        else registration_status end,
      verified_at = case when p_status = 'verified' then now() else verified_at end,
      verified_by = case when p_status = 'verified' then v_uid else verified_by end
    where team_id = v_reg.team_id and id <> p_registration_id;
  end if;

  insert into public.payment_events(registration_id, actor_id, action, from_status, to_status, note)
  values (p_registration_id, v_uid, 'admin_review', v_from, p_status, p_note);
  return v_reg;
end $$;
