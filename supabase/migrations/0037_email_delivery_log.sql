-- D030: PII-minimized, append-only email telemetry. No trigger sends email.
create table if not exists public.email_delivery_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  kind text not null check (kind in ('welcome','registration_confirmed','payment_status','smtp_check')),
  outcome text not null check (outcome in ('sent','not_configured','failed','verified')),
  registration_id uuid,
  actor_id uuid,
  source text not null check (source in ('automatic','manual','check')),
  error_class text check (error_class in ('configuration','authentication','connection','timeout','provider','unknown')),
  error_code text check (error_code in ('NOT_CONFIGURED','EAUTH','ECONNECTION','ECONNREFUSED','ECONNRESET','ETIMEDOUT','ESOCKET','EDNS','ENOTFOUND','ETLS','EENVELOPE','EMESSAGE','ESTREAM','SMTP_4XX','SMTP_5XX','UNKNOWN')),
  provider_message_id text check (provider_message_id ~ '^[0-9a-f]{64}$'),
  check ((source = 'automatic' and actor_id is null) or (source in ('manual','check') and actor_id is not null)),
  check ((kind = 'smtp_check') = (source = 'check')),
  check (source <> 'manual' or kind = 'registration_confirmed'),
  check (outcome <> 'verified' or kind = 'smtp_check')
);
create index if not exists email_delivery_log_recent_idx on public.email_delivery_log (created_at desc);
create table if not exists public.registration_email_resend_claims (
  request_id uuid primary key,
  registration_id uuid not null,
  throttle_registration_id uuid not null,
  actor_id uuid not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists registration_email_resend_claims_recent_idx
  on public.registration_email_resend_claims (throttle_registration_id, created_at desc);
alter table public.email_delivery_log enable row level security;
alter table public.registration_email_resend_claims enable row level security;
-- Supabase defaults may grant ALL; revoke before issuing narrow privileges.
revoke all on public.email_delivery_log, public.registration_email_resend_claims from public, anon, authenticated, service_role;
grant usage on schema public to service_role;
grant insert (kind, outcome, registration_id, actor_id, source, error_class, error_code, provider_message_id)
  on public.email_delivery_log to service_role;

create or replace function public.reject_email_audit_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'EMAIL_AUDIT_APPEND_ONLY'; end $$;
revoke all on function public.reject_email_audit_mutation() from public, anon, authenticated, service_role;
drop trigger if exists email_delivery_log_append_only on public.email_delivery_log;
create trigger email_delivery_log_append_only before update or delete or truncate on public.email_delivery_log
  for each statement execute function public.reject_email_audit_mutation();
drop trigger if exists registration_email_resend_claims_append_only on public.registration_email_resend_claims;
create trigger registration_email_resend_claims_append_only before update or delete or truncate on public.registration_email_resend_claims
  for each statement execute function public.reject_email_audit_mutation();

-- Recent aggregate only: no actor, registration, error detail or provider IDs.
create or replace function public.email_delivery_summary()
returns table (kind text, outcome text, source text, attempts bigint, last_attempt_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_super_admin() then raise exception 'FORBIDDEN'; end if;
  return query select l.kind, l.outcome, l.source, count(*), max(l.created_at)
    from public.email_delivery_log l
    where l.created_at >= statement_timestamp() - interval '7 days'
    group by l.kind, l.outcome, l.source order by l.kind, l.outcome, l.source;
end $$;

create or replace function public.claim_registration_email_resend(p_registration_id uuid, p_request_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.registration_email_resend_claims%rowtype;
  v_reg public.registrations%rowtype;
  v_head public.registrations%rowtype;
  v_event_id uuid;
  v_throttle_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_super_admin() then raise exception 'FORBIDDEN'; end if;
  if p_registration_id is null or p_request_id is null then raise exception 'INVALID_REQUEST'; end if;
  -- Serialize request replay even across different registrations. Hash collision
  -- merely serializes unrelated requests; the UUID primary key remains authority.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 37));
  select * into v_existing from public.registration_email_resend_claims where request_id = p_request_id;
  if found then
    if v_existing.actor_id <> v_actor or v_existing.registration_id <> p_registration_id then
      raise exception 'REQUEST_ID_REUSED';
    end if;
    return false;
  end if;
  select event_id into v_event_id from public.registrations where id = p_registration_id;
  if not found then raise exception 'REGISTRATION_NOT_FOUND'; end if;
  -- Match registration/payment/roster RPC lock order: event, then rows.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_event_id::text));
  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found then raise exception 'REGISTRATION_NOT_FOUND'; end if;
  if v_reg.registration_status <> 'confirmed' or v_reg.payment_status <> 'verified' then
    raise exception 'REGISTRATION_NOT_CONFIRMED';
  end if;
  v_throttle_id := v_reg.id;
  if v_reg.team_id is not null then
    select * into v_head from public.registrations
      where team_id = v_reg.team_id and event_id = v_reg.event_id and is_team_head
      order by id limit 1 for update;
    if not found or v_head.registration_status <> 'confirmed' or v_head.payment_status <> 'verified' then
      raise exception 'REGISTRATION_NOT_CONFIRMED';
    end if;
    v_throttle_id := v_head.id;
  end if;
  if exists (select 1 from public.registration_email_resend_claims c
      where c.throttle_registration_id = v_throttle_id and c.created_at > clock_timestamp() - interval '60 seconds') then
    return false;
  end if;
  insert into public.registration_email_resend_claims (request_id, registration_id, throttle_registration_id, actor_id)
    values (p_request_id, p_registration_id, v_throttle_id, v_actor);
  return true;
end $$;
revoke all on function public.email_delivery_summary(), public.claim_registration_email_resend(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.email_delivery_summary(), public.claim_registration_email_resend(uuid, uuid) to authenticated;
