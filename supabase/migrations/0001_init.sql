-- ============================================================================
-- WISSENDURST'27 — 0001_init
-- Enums, tables, participant-ID generation, triggers, indexes.
-- Money is stored as INTEGER PAISE. Timestamps are timestamptz.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── Enums ───────────────────────────────────────────────────────────────────
do $$ begin
  create type user_role as enum ('user', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type event_category as enum
    ('workshop','debate','poster','paper','competition','academic','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type registration_status as enum
    ('pending','confirmed','cancelled','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum
    ('unpaid','uploaded','under_review','verified','rejected','duplicate');
exception when duplicate_object then null; end $$;

-- ── updated_at helper ───────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ── Participant ID generator ────────────────────────────────────────────────
-- 5 chars from an unambiguous alphabet (no O 0 I 1 L). Server-side only.
create or replace function public.gen_participant_code()
returns text language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- 31 chars
  code text := '';
  i int;
begin
  for i in 1..5 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return code;
end $$;

-- ── profiles ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  participant_id text unique not null,
  full_name      text not null default '',
  email          text not null,
  phone          text,
  college        text,
  course         text,
  year           text,
  profile_photo  text,
  role           user_role not null default 'user',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- Assign a collision-free participant_id before insert if not supplied.
create or replace function public.assign_participant_id()
returns trigger language plpgsql as $$
declare
  candidate text;
  attempts int := 0;
begin
  if new.participant_id is not null and new.participant_id <> '' then
    return new;
  end if;
  loop
    candidate := public.gen_participant_code();
    exit when not exists (
      select 1 from public.profiles where participant_id = candidate
    );
    attempts := attempts + 1;
    if attempts > 50 then
      raise exception 'Could not generate a unique participant_id';
    end if;
  end loop;
  new.participant_id := candidate;
  return new;
end $$;

drop trigger if exists trg_assign_participant_id on public.profiles;
create trigger trg_assign_participant_id before insert on public.profiles
  for each row execute function public.assign_participant_id();

-- Create a profile automatically for every new auth user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, phone, college, course, year)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'college',
    new.raw_user_meta_data->>'course',
    new.raw_user_meta_data->>'year'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── events ──────────────────────────────────────────────────────────────────
create table if not exists public.events (
  id                uuid primary key default gen_random_uuid(),
  slug              text unique not null,
  title             text not null,
  short_description text not null default '',
  description       text not null default '',
  category          event_category not null default 'other',
  hero_image        text,
  thumbnail_image   text,
  rules             jsonb not null default '[]'::jsonb,
  eligibility       text,
  registration_fee  integer not null default 0 check (registration_fee >= 0),
  venue             text,
  event_date        date,
  start_time        time,
  end_time          time,
  max_participants  integer check (max_participants is null or max_participants > 0),
  registration_open boolean not null default true,
  featured          boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists trg_events_updated on public.events;
create trigger trg_events_updated before update on public.events
  for each row execute function public.set_updated_at();

create index if not exists idx_events_category on public.events(category);
create index if not exists idx_events_featured on public.events(featured) where featured;

-- ── registrations ───────────────────────────────────────────────────────────
create table if not exists public.registrations (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null references public.profiles(id) on delete cascade,
  event_id            uuid not null references public.events(id) on delete cascade,
  registration_status registration_status not null default 'pending',
  payment_status      payment_status not null default 'unpaid',
  transaction_id      text,
  duplicate_of        uuid references public.registrations(id) on delete set null,
  payment_screenshot  text,
  ocr_raw_text        text,
  ocr_confidence      numeric(4,3),
  amount              integer not null default 0 check (amount >= 0),
  registered_at       timestamptz not null default now(),
  verified_at         timestamptz,
  verified_by         uuid references public.profiles(id) on delete set null,
  updated_at          timestamptz not null default now(),
  unique (profile_id, event_id)
);

-- Duplicate-transaction defense at the DB layer. NULLs are allowed & ignored.
create unique index if not exists uq_registrations_txn
  on public.registrations (transaction_id)
  where transaction_id is not null;

create index if not exists idx_reg_event on public.registrations(event_id);
create index if not exists idx_reg_profile on public.registrations(profile_id);
create index if not exists idx_reg_payment_status on public.registrations(payment_status);

drop trigger if exists trg_reg_updated on public.registrations;
create trigger trg_reg_updated before update on public.registrations
  for each row execute function public.set_updated_at();

-- ── payment_events (audit log) ──────────────────────────────────────────────
create table if not exists public.payment_events (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  actor_id        uuid references public.profiles(id) on delete set null,
  action          text not null,
  from_status     payment_status,
  to_status       payment_status,
  note            text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_payment_events_reg on public.payment_events(registration_id);
