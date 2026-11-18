-- D031: narrow superadmin-only inventory; raw delivery evidence remains private.
-- A partial team retry deliberately retries the entire current recipient set.
-- Accepted telemetry is SMTP acceptance, not proof of inbox delivery. D030 may
-- record multiple recipients against a single calling registration_id.
create or replace function public.email_backfill_inventory()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_inventory jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_super_admin() then raise exception 'FORBIDDEN'; end if;
  with recipients as (
    select r.id, case when r.team_id is null then r.id else h.id end as registration_id
    from public.registrations r
    left join lateral (
      select head.id from public.registrations head
      where head.team_id = r.team_id and head.event_id = r.event_id
        and head.is_team_head and head.registration_status = 'confirmed'
        and head.payment_status = 'verified'
      order by head.id limit 1
    ) h on r.team_id is not null
    where r.registration_status = 'confirmed' and r.payment_status = 'verified'
      and (r.team_id is null or h.id is not null)
  ), accepted as (
    select l.registration_id, count(*) as sent_count
    from public.email_delivery_log l
    where l.kind = 'registration_confirmed' and l.outcome = 'sent'
    group by l.registration_id
  ), units as (
    select r.registration_id, count(*) as recipient_count,
      least(count(*), coalesce(sum(a.sent_count),0)::bigint) as sent_count
    from recipients r left join accepted a on a.registration_id = r.id
    group by r.registration_id
  ), gaps as (
    select * from units where sent_count < recipient_count
  )
  select jsonb_build_object(
    'units', coalesce(jsonb_agg(jsonb_build_object(
      'registration_id', registration_id, 'recipient_count', recipient_count,
      'sent_count', sent_count) order by registration_id), '[]'::jsonb),
    'remaining_units', count(*),
    'remaining_recipient_events', coalesce(sum(recipient_count),0)
  ) into v_inventory from gaps;
  return v_inventory;
end $$;
revoke all on function public.email_backfill_inventory() from public, anon, authenticated, service_role;
grant execute on function public.email_backfill_inventory() to authenticated;
