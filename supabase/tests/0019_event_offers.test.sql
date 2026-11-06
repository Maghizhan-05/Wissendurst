-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0019_event_offers: directed source→target offers, verified-source
-- eligibility, single best discount, cap, team pricing via the head, frozen
-- prices, admin editor validation, grants/RLS, legacy sibling logic retired.
\set ON_ERROR_STOP 1
grant all on all tables in schema public to anon, authenticated;

create or replace function pg_temp.expect_error(p_sql text, p_needle text) returns text
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_ERROR_NOT_RAISED: % (wanted %)', p_sql, p_needle;
exception when others then
  if sqlerrm like 'EXPECTED_ERROR_NOT_RAISED%' or position(p_needle in sqlerrm) = 0 then
    raise exception 'WRONG_ERROR for %: got "%" wanted "%"', p_sql, sqlerrm, p_needle;
  end if;
  return 'PASS error ' || p_needle;
end $$;
create or replace function pg_temp.check(p_ok boolean, p_label text) returns text
language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_label; end if;
  return 'PASS ' || p_label;
end $$;
create or replace function pg_temp.u(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000004' || lpad(p_n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.ev(p_slug text) returns uuid language sql stable security definer as $$
  select id from public.events where slug = p_slug $$;
create or replace function pg_temp.reg(p_n int, p_slug text) returns public.registrations language sql stable security definer as $$
  select * from public.registrations where profile_id = pg_temp.u(p_n) and event_id = pg_temp.ev(p_slug) $$;
create or replace function pg_temp.price(p_n int, p_slug text, p_size int default 1) returns int language sql stable security definer as $$
  select amount from public.event_offer_price(pg_temp.u(p_n), pg_temp.ev(p_slug), p_size) $$;
create or replace function pg_temp.as_user(p_n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, false) $$;
-- Gives user n a confirmed, verified registration on an event (admin path).
create or replace function pg_temp.verified_on(p_n int, p_slug text) returns void language plpgsql security definer as $$
declare r public.registrations;
begin
  insert into public.registrations(profile_id, event_id, amount, registration_status, payment_status, hold_expires_at)
  values (pg_temp.u(p_n), pg_temp.ev(p_slug), 1, 'confirmed', 'verified', null)
  on conflict (profile_id, event_id) do update set registration_status='confirmed', payment_status='verified';
end $$;
create or replace function pg_temp.offers(p_slug text) returns text language sql stable security definer as $$
  select coalesce(string_agg((select slug from public.events where id = o.target_event_id) || ':' || o.discount_amount || ':' || o.enabled,
                             ',' order by (select slug from public.events where id = o.target_event_id)), '')
  from public.event_offers o where o.source_event_id = pg_temp.ev(p_slug) $$;

insert into auth.users (id, email, raw_user_meta_data)
select pg_temp.u(n), 'w'||n||'@x.test', json_build_object('full_name','W'||n)::jsonb
from generate_series(0, 7) n;
update public.profiles set approval_status = 'approved';
update public.profiles set role = 'admin', admin_scopes = array['events','payments'] where id = pg_temp.u(0);
update public.profiles set role = 'admin', admin_scopes = array['payments'] where id = pg_temp.u(7);

insert into public.events (slug, title, registration_fee, team_fee, registration_open, is_live, team_enabled, team_max) values
 ('a', 'A', 1000, 0, true, true, false, 4),
 ('b', 'B', 1000, 0, true, true, false, 4),
 ('d', 'D', 5000, 0, true, true, false, 4),
 ('e', 'E', 1000, 0, true, true, false, 4),
 ('t', 'Team', 4000, 10000, true, true, true, 3),
 ('x', 'Archived', 1000, 0, true, true, false, 4),
 ('c', 'Container', 0, 0, true, true, false, 4);
insert into public.events (slug, title, registration_fee, registration_open, is_live, parent_event_id) values
 ('c1', 'C1', 1000, true, true, pg_temp.ev('c'));
-- Legacy sibling setup: parent with an active (retired) sibling discount.
insert into public.events (slug, title, registration_fee, registration_open, is_live, discount_enabled, discount_amount) values
 ('p', 'Parent', 0, true, true, true, 3000);
insert into public.events (slug, title, registration_fee, registration_open, is_live, parent_event_id) values
 ('p1', 'P1', 5000, true, true, pg_temp.ev('p')),
 ('p2', 'P2', 5000, true, true, pg_temp.ev('p'));
update public.events set archived_at = now() where slug = 'x';

set role authenticated;

-- 1. Admin editor creates directed mappings
select pg_temp.as_user(0);
select public.admin_set_event_offers(pg_temp.ev('a'), jsonb_build_array(
  jsonb_build_object('target_event_id', pg_temp.ev('d'), 'discount_amount', 2000, 'enabled', true),
  jsonb_build_object('target_event_id', pg_temp.ev('e'), 'discount_amount', 2000, 'enabled', true),
  jsonb_build_object('target_event_id', pg_temp.ev('t'), 'discount_amount', 3000, 'enabled', true))) = 3;
select public.admin_set_event_offers(pg_temp.ev('b'), jsonb_build_array(
  jsonb_build_object('target_event_id', pg_temp.ev('d'), 'discount_amount', 3000))) = 1;
select pg_temp.check(pg_temp.offers('a') = 'd:2000:true,e:2000:true,t:3000:true' and pg_temp.offers('b') = 'd:3000:true', '1: offers stored per source→target with own amounts');

-- 2. Direction: A → D does not imply D → A
reset role; select pg_temp.verified_on(1, 'd'); set role authenticated;
select pg_temp.check(pg_temp.price(1, 'a') = 1000, '2: verified on D gives no offer on A (no reverse mapping)');

-- 3. Hierarchy alone grants nothing (legacy sibling discount retired)
reset role; select pg_temp.verified_on(1, 'p1'); set role authenticated;
select pg_temp.as_user(1);
select (public.register_for_event(pg_temp.ev('p2'))).amount = 5000 as sibling_pays_full;
select pg_temp.check((pg_temp.reg(1,'p2')).offer_discount = 0, '3: sibling under a discount-enabled parent pays full price');

-- 4. Only a confirmed registration with VERIFIED payment on the source qualifies
select pg_temp.as_user(2);
select (public.register_for_event(pg_temp.ev('a'))).registration_status = 'pending';
select pg_temp.check(pg_temp.price(2, 'd') = 5000, '4: pending intent on source does not qualify');
select (public.submit_payment((pg_temp.reg(2,'a')).id, 'UTRW000002', null)).payment_status = 'under_review';
select pg_temp.check(pg_temp.price(2, 'd') = 5000, '4: payment under review does not qualify');
select pg_temp.as_user(0);
select (public.admin_set_payment_status((pg_temp.reg(2,'a')).id, 'verified', null)).payment_status = 'verified';
select pg_temp.check(pg_temp.price(2, 'd') = 3000, '4: verified source unlocks the offer (5000 - 2000)');
select (public.admin_set_payment_status((pg_temp.reg(2,'a')).id, 'rejected', null)).payment_status = 'rejected';
select pg_temp.check(pg_temp.price(2, 'd') = 5000, '4: rejected source no longer qualifies');

-- 5. Several qualifying sources → single highest discount, no stacking; price frozen with details
reset role; select pg_temp.verified_on(3, 'a'); select pg_temp.verified_on(3, 'b'); set role authenticated;
select pg_temp.as_user(3);
select pg_temp.check((select solo_amount = 2000 and solo_discount = 3000 from public.my_offer_prices(array[pg_temp.ev('d')])),
  '5: preview shows the single best offer (3000), not stacked (5000)');
select (public.register_for_event(pg_temp.ev('d'))).amount = 2000 as best_offer_applied;
select pg_temp.check((select list_price = 5000 and offer_discount = 3000 and offer_source_event_id = pg_temp.ev('b')
   from pg_temp.reg(3,'d')), '5: intent stores list price, discount and source event');

-- 6. Frozen: changing / disabling the offer does not touch the existing intent
select pg_temp.as_user(0);
select public.admin_set_event_offers(pg_temp.ev('b'), jsonb_build_array(
  jsonb_build_object('target_event_id', pg_temp.ev('d'), 'discount_amount', 500, 'enabled', false))) = 1;
select pg_temp.check((pg_temp.reg(3,'d')).amount = 2000, '6: existing intent keeps its frozen price');
select pg_temp.check(pg_temp.price(3, 'd') = 3000, '6: disabled offer ignored; next best (A→D 2000) applies');

-- 7. Cap at the target price: fully covered registration confirms immediately
select pg_temp.as_user(3);
select pg_temp.check((select registration_status = 'confirmed' and amount = 0 and offer_discount = 1000 and list_price = 1000
   from public.register_for_event(pg_temp.ev('e'))), '7: discount capped at price (2000 → 1000), confirmed at 0');

-- 8. Teams: head's eligibility against the team fee / lone fee
select pg_temp.as_user(3);
select pg_temp.check((select team_amount = 7000 and team_discount = 3000 and solo_amount = 1000 from public.my_offer_prices(array[pg_temp.ev('t')])),
  '8: preview: team 10000-3000, team of one 4000-3000');
select (public.register_team(pg_temp.ev('t'), array[pg_temp.u(5)], 'Test team')).amount = 7000 as team_offer_applied;
select pg_temp.check((select list_price = 10000 and offer_discount = 3000 from pg_temp.reg(3,'t'))
   and (select amount = 0 and offer_discount = 0 from pg_temp.reg(5,'t')), '8: head pays discounted team fee, member 0');
select pg_temp.as_user(4);
select (public.register_team(pg_temp.ev('t'), array[pg_temp.u(1)], 'Test team')).amount = 10000 as ineligible_head_full_price;
select pg_temp.as_user(6);
reset role; select pg_temp.verified_on(6, 'a'); set role authenticated;
select (public.register_team(pg_temp.ev('t'), array[]::uuid[])).amount = 1000 as lone_member_offer;

-- 9. Editor validation
select pg_temp.as_user(0);
select pg_temp.expect_error(format($q$select public.admin_set_event_offers(%L, %L)$q$, pg_temp.ev('a'),
  jsonb_build_array(jsonb_build_object('target_event_id', pg_temp.ev('a'), 'discount_amount', 100))), 'OFFER_SELF_TARGET');
select pg_temp.expect_error(format($q$select public.admin_set_event_offers(%L, %L)$q$, pg_temp.ev('a'),
  jsonb_build_array(jsonb_build_object('target_event_id', pg_temp.ev('d'), 'discount_amount', 100),
                    jsonb_build_object('target_event_id', pg_temp.ev('d'), 'discount_amount', 200))), 'OFFER_DUPLICATE_TARGET');
select pg_temp.expect_error(format($q$select public.admin_set_event_offers(%L, %L)$q$, pg_temp.ev('a'),
  jsonb_build_array(jsonb_build_object('target_event_id', pg_temp.ev('d'), 'discount_amount', 0))), 'OFFER_INVALID_AMOUNT');
select pg_temp.expect_error(format($q$select public.admin_set_event_offers(%L, %L)$q$, pg_temp.ev('a'),
  jsonb_build_array(jsonb_build_object('target_event_id', pg_temp.ev('d'), 'discount_amount', -5))), 'OFFER_INVALID_AMOUNT');
select pg_temp.expect_error(format($q$select public.admin_set_event_offers(%L, %L)$q$, pg_temp.ev('a'),
  jsonb_build_array(jsonb_build_object('target_event_id', pg_temp.ev('d'), 'discount_amount', 10.5))), 'OFFER_INVALID_AMOUNT');
select pg_temp.expect_error(format($q$select public.admin_set_event_offers(%L, %L)$q$, pg_temp.ev('a'),
  jsonb_build_array(jsonb_build_object('target_event_id', gen_random_uuid(), 'discount_amount', 100))), 'OFFER_TARGET_NOT_FOUND');
select pg_temp.expect_error(format($q$select public.admin_set_event_offers(%L, %L)$q$, pg_temp.ev('a'),
  jsonb_build_array(jsonb_build_object('target_event_id', pg_temp.ev('x'), 'discount_amount', 100))), 'OFFER_TARGET_ARCHIVED');
select pg_temp.expect_error(format($q$select public.admin_set_event_offers(%L, %L)$q$, pg_temp.ev('a'),
  jsonb_build_array(jsonb_build_object('target_event_id', pg_temp.ev('c'), 'discount_amount', 100))), 'OFFER_TARGET_NOT_REGISTRABLE');
select pg_temp.expect_error(format($q$select public.admin_set_event_offers(%L, %L)$q$, pg_temp.ev('a'),
  jsonb_build_array(jsonb_build_object('target_event_id', 'not-a-uuid', 'discount_amount', 100))), 'OFFER_INVALID');
select pg_temp.expect_error(format($q$select public.admin_set_event_offers(%L, %L)$q$, pg_temp.ev('a'), '{}'), 'OFFER_INVALID');
select pg_temp.check(pg_temp.offers('a') = 'd:2000:true,e:2000:true,t:3000:true', '9: rejected edits left offers unchanged');
reset role;
select pg_temp.expect_error($q$insert into public.event_offers(source_event_id, target_event_id, discount_amount) values (pg_temp.ev('a'), pg_temp.ev('a'), 100)$q$, 'event_offers_not_self');
select pg_temp.expect_error($q$insert into public.event_offers(source_event_id, target_event_id, discount_amount) values (pg_temp.ev('a'), pg_temp.ev('d'), 100)$q$, 'event_offers_unique_pair');
set role authenticated;

-- 10. Permissions: events scope required; participants can't read or call internals
select pg_temp.as_user(7);
select pg_temp.expect_error(format($q$select public.admin_set_event_offers(%L, '[]')$q$, pg_temp.ev('a')), 'FORBIDDEN');
select pg_temp.as_user(1);
select pg_temp.expect_error(format($q$select public.admin_set_event_offers(%L, '[]')$q$, pg_temp.ev('a')), 'FORBIDDEN');
select pg_temp.check((select count(*) from public.event_offers) = 0, '10: participants cannot read offer mappings');
select pg_temp.expect_error($q$select * from public.event_offer_price(pg_temp.u(1), pg_temp.ev('d'), 1)$q$, 'permission denied');
reset role; set role anon;
select pg_temp.expect_error($q$select * from public.my_offer_prices(array[pg_temp.ev('d')])$q$, 'permission denied');
reset role; set role authenticated;
select pg_temp.as_user(0);
select pg_temp.check((select count(*) from public.event_offers) = 4, '10: admin reads offer mappings');

-- 11. Replace semantics; existing mapping to a since-archived target may be kept
select public.admin_set_event_offers(pg_temp.ev('a'), jsonb_build_array(
  jsonb_build_object('target_event_id', pg_temp.ev('e'), 'discount_amount', 700))) = 1;
select pg_temp.check(pg_temp.offers('a') = 'e:700:true', '11: saving replaces the source''s offer list');
reset role; update public.events set archived_at = now() where slug = 'e'; set role authenticated;
select public.admin_set_event_offers(pg_temp.ev('a'), jsonb_build_array(
  jsonb_build_object('target_event_id', pg_temp.ev('e'), 'discount_amount', 800))) = 1;
select pg_temp.check(pg_temp.offers('a') = 'e:800:true', '11: existing mapping to an archived target can still be edited');
select public.admin_set_event_offers(pg_temp.ev('a'), '[]'::jsonb) = 0;
select pg_temp.check(pg_temp.offers('a') = '', '11: empty list removes all offers');

-- 12. Legacy columns retained, untouched
reset role;
select pg_temp.check((select discount_enabled and discount_amount = 3000 from public.events where slug = 'p'), '12: legacy sibling columns kept, not dropped');
select 'ALL 0019 TESTS PASSED';
