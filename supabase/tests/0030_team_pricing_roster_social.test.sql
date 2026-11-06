-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0030: per-team-size pricing, team names, pre-payment roster editing
-- (removed teammates deleted, hold never extended, evidence locks), social links.
\set ON_ERROR_STOP 1
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
\ir ../migrations/0030_team_pricing_roster_social.sql

create or replace function pg_temp.expect_error(p_sql text, p_needle text) returns text
language plpgsql as $$
declare v_detail text;
begin
  execute p_sql;
  raise exception 'EXPECTED_ERROR_NOT_RAISED: % (wanted %)', p_sql, p_needle;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  if sqlerrm like 'EXPECTED_ERROR_NOT_RAISED%' or position(p_needle in sqlerrm || ' ' || coalesce(v_detail, '')) = 0 then
    raise exception 'WRONG_ERROR for %: got "%" (%) wanted "%"', p_sql, sqlerrm, v_detail, p_needle;
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
  select ('00000000-0000-0000-0000-0000000018' || lpad(p_n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.ev(p_slug text) returns uuid language sql stable security definer as $$
  select id from public.events where slug = p_slug $$;
create or replace function pg_temp.reg(p_n int, p_slug text) returns public.registrations language sql stable security definer as $$
  select * from public.registrations where profile_id = pg_temp.u(p_n) and event_id = pg_temp.ev(p_slug) $$;
create or replace function pg_temp.tiers(p_slug text) returns text language sql stable security definer as $$
  select string_agg(team_size || ':' || fee, ',' order by team_size) from public.event_team_price_tiers where event_id = pg_temp.ev(p_slug) $$;
create or replace function pg_temp.team(p_n int, p_slug text) returns public.teams language sql stable security definer as $$
  select t.* from public.teams t where t.id = (pg_temp.reg(p_n, p_slug)).team_id $$;
create or replace function pg_temp.members(p_n int, p_slug text) returns text language sql stable security definer as $$
  select string_agg(right(profile_id::text, 2), ',' order by profile_id) from public.registrations
  where team_id = (pg_temp.reg(p_n, p_slug)).team_id $$;
create or replace function pg_temp.as_user(p_n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, false) $$;
create or replace function pg_temp.q(p_sql text) returns boolean language plpgsql security definer as $$
declare v boolean; begin execute p_sql into v; return v; end $$;

-- users: 00 events admin, 01 content admin, 02..12 participants, 13 unapproved
insert into auth.users (id, email, raw_user_meta_data)
select pg_temp.u(n), 'p'||n||'@x.test', json_build_object('full_name','P'||n)::jsonb from generate_series(0, 13) n;
update public.profiles set approval_status = 'approved' where id <> pg_temp.u(13);
update public.profiles set role = 'admin', admin_scopes = array['events'] where id = pg_temp.u(0);
update public.profiles set role = 'admin', admin_scopes = array['content'] where id = pg_temp.u(1);

-- ── 1. backfill/sync: legacy prices become tiers 1..team_max ───────────────
insert into public.events (slug, title, registration_fee, team_fee, registration_open, is_live, team_enabled, team_max, max_participants) values
  ('legacy', 'Legacy team', 15000, 30000, true, true, true, 4, null),
  ('solo', 'Solo event', 5000, 0, true, true, false, 4, null);
select pg_temp.check(pg_temp.tiers('legacy') = '1:15000,2:30000,3:30000,4:30000', '1: team event priced exactly as before (size 1 = fee, 2..max = team fee)');
select pg_temp.check(pg_temp.tiers('solo') is null, '1: non-team events have no tiers');
select pg_temp.check((select count(*) = 0 from public.events e where e.team_enabled
  and (select count(*) from public.event_team_price_tiers t where t.event_id = e.id) <> e.team_max), '1: every team event prices every size');
select pg_temp.expect_error($q$update public.events set team_max = 11 where slug = 'legacy'$q$, 'events_team_size_range');

-- ── 2. pricing RPC ─────────────────────────────────────────────────────────
set role authenticated;
select pg_temp.as_user(0);
select public.admin_set_event_pricing(pg_temp.ev('legacy'), null, true, 2, 6, '[15000,30000,40000,50000,55000,60000]');
reset role;
select pg_temp.check(pg_temp.tiers('legacy') = '1:15000,2:30000,3:40000,4:50000,5:55000,6:60000'
  and (select registration_fee = 15000 and team_max = 6 and team_min = 2 from public.events where slug = 'legacy'), '2: six prices saved (sizes 1..max even with min 2); registration_fee = solo price');
set role authenticated;
select pg_temp.as_user(5);
select pg_temp.expect_error($q$select public.register_team(pg_temp.ev('legacy'), array[]::uuid[], null)$q$, 'TEAM_TOO_SMALL');
reset role;
set role authenticated;
select pg_temp.as_user(0);
select pg_temp.expect_error($q$select public.admin_set_event_pricing(pg_temp.ev('legacy'), null, true, 1, 6, '[1,2,3]')$q$, 'tiers');
select pg_temp.expect_error($q$select public.admin_set_event_pricing(pg_temp.ev('legacy'), null, true, 1, 3, '[100,-5,300]')$q$, 'tier 2');
select pg_temp.expect_error($q$select public.admin_set_event_pricing(pg_temp.ev('legacy'), null, true, 1, 3, '[100,4.5,300]')$q$, 'tier 2');
select pg_temp.expect_error($q$select public.admin_set_event_pricing(pg_temp.ev('legacy'), null, true, 1, 3, '[100,"200",300]')$q$, 'tier 2');
select pg_temp.expect_error($q$select public.admin_set_event_pricing(pg_temp.ev('legacy'), null, true, 1, 11, '[1,1,1,1,1,1,1,1,1,1,1]')$q$, 'team_max');
select pg_temp.expect_error($q$select public.admin_set_event_pricing(pg_temp.ev('legacy'), null, true, 4, 3, '[1,2,3]')$q$, 'team_min');
select pg_temp.expect_error($q$select public.admin_set_event_pricing(gen_random_uuid(), 0, false, 1, 1, null)$q$, 'EVENT_NOT_FOUND');
select pg_temp.as_user(1);
select pg_temp.expect_error($q$select public.admin_set_event_pricing(pg_temp.ev('legacy'), null, true, 1, 2, '[1,2]')$q$, 'FORBIDDEN');
select pg_temp.as_user(2);
select pg_temp.expect_error($q$select public.admin_set_event_pricing(pg_temp.ev('legacy'), null, true, 1, 2, '[1,2]')$q$, 'FORBIDDEN');
-- direct client writes can't touch team settings or a team event's price
select pg_temp.as_user(0);
select pg_temp.expect_error($q$update public.events set team_max = 2 where slug = 'legacy'$q$, 'EVENT_PRICING_VIA_RPC');
select pg_temp.expect_error($q$update public.events set registration_fee = 1 where slug = 'legacy'$q$, 'EVENT_PRICING_VIA_RPC');
select pg_temp.expect_error($q$update public.events set team_fee = 1 where slug = 'legacy'$q$, 'EVENT_PRICING_VIA_RPC');
select pg_temp.expect_error($q$update public.events set team_enabled = true where slug = 'solo'$q$, 'EVENT_PRICING_VIA_RPC');
select pg_temp.expect_error($q$insert into public.events (slug, title, team_enabled) values ('direct-team', 'X', true)$q$, 'EVENT_PRICING_VIA_RPC');
select pg_temp.expect_error($q$insert into public.event_team_price_tiers values (pg_temp.ev('legacy'), 7, 1)$q$, 'permission denied');
update public.events set registration_fee = 6000, title = 'Solo event!' where slug = 'solo';   -- non-team fee still direct
-- shrink, then disable/enable
select public.admin_set_event_pricing(pg_temp.ev('legacy'), null, true, 1, 3, '[15000,30000,40000]');
reset role;
select pg_temp.check(pg_temp.tiers('legacy') = '1:15000,2:30000,3:40000', '2: lowering the max drops larger sizes');
set role anon;
select pg_temp.check((select count(*) = 3 from public.event_team_price_tiers where event_id = pg_temp.ev('legacy')), '2: prices are publicly readable');
select pg_temp.expect_error($q$select public.admin_set_event_pricing(pg_temp.ev('legacy'), 1, false, 1, 1, null)$q$, 'permission denied');
select pg_temp.expect_error($q$select * from public.my_team_prices(pg_temp.ev('legacy'))$q$, 'permission denied');
reset role;
set role authenticated;
select pg_temp.as_user(0);
select public.admin_set_event_pricing(pg_temp.ev('solo'), 7000, false, 1, 4, null);
select public.admin_set_event_pricing(pg_temp.ev('solo'), null, true, 1, 2, '[7000,9000]');
select public.admin_set_event_pricing(pg_temp.ev('solo'), 7500, false, 1, 2, null);
reset role;
select pg_temp.check(pg_temp.tiers('solo') is null and (select not team_enabled and registration_fee = 7500 from public.events where slug = 'solo'),
  '2: switching team pricing off removes the tiers and sets the plain fee');

-- ── 3. prices per size + team names at registration ───────────────────────
select pg_temp.check((select list_price = 40000 from public.event_offer_price(pg_temp.u(2), pg_temp.ev('legacy'), 3))
  and (select list_price = 15000 from public.event_offer_price(pg_temp.u(2), pg_temp.ev('legacy'), 1)), '3: price follows the exact team size');
set role authenticated;
select pg_temp.as_user(2);
select pg_temp.check((select string_agg(team_size || ':' || amount, ',' order by team_size) = '1:15000,2:30000,3:40000' from public.my_team_prices(pg_temp.ev('legacy'))),
  '3: my_team_prices lists every size');
select pg_temp.check((select team_list = 30000 from public.my_offer_prices(array[pg_temp.ev('legacy')])), '3: my_offer_prices team column = size 2');
reset role;
insert into public.events (slug, title, registration_fee, team_fee, registration_open, is_live, team_enabled, team_max) values ('one', 'Max one', 9000, 0, true, true, true, 1);
set role authenticated;
select pg_temp.as_user(2);
select pg_temp.check((select team_list = 9000 from public.my_offer_prices(array[pg_temp.ev('one')])), '3: max-size-1 team event previews without error');
select pg_temp.expect_error($q$select public.register_team(pg_temp.ev('legacy'), array[pg_temp.u(3)])$q$, 'TEAM_NAME_REQUIRED');
select pg_temp.expect_error($q$select public.register_team(pg_temp.ev('legacy'), array[pg_temp.u(3)], '   ')$q$, 'TEAM_NAME_REQUIRED');
select pg_temp.expect_error(format($q$select public.register_team(pg_temp.ev('legacy'), array[pg_temp.u(3)], %L)$q$, repeat('x', 61)), 'TEAM_NAME_INVALID');
select pg_temp.expect_error(format($q$select public.register_team(pg_temp.ev('legacy'), array[pg_temp.u(3)], %L)$q$, 'Bad' || chr(10) || 'Name'), 'TEAM_NAME_INVALID');
select public.register_team(pg_temp.ev('legacy'), array[pg_temp.u(3), pg_temp.u(4)], '  ' || repeat('N', 60) || ' ');
reset role;
select pg_temp.check((pg_temp.team(2, 'legacy')).name = repeat('N', 60) and (pg_temp.reg(2, 'legacy')).amount = 40000,
  '3: 60-character name stored trimmed; team of 3 frozen at the size-3 price');
set role authenticated;
select pg_temp.as_user(5);
select public.register_team(pg_temp.ev('legacy'), array[]::uuid[], 'Ignored for solo');
reset role;
select pg_temp.check((pg_temp.team(5, 'legacy')).name is null and (pg_temp.reg(5, 'legacy')).amount = 15000, '3: a solo registration has no team name and pays the size-1 price');
select pg_temp.expect_error($q$update public.teams set name = ' padded' where id = (pg_temp.reg(2, 'legacy')).team_id$q$, 'teams_name_valid');

-- ── 4. roster editing ──────────────────────────────────────────────────────
create temp table hold0 as select (pg_temp.reg(2, 'legacy')).hold_expires_at h;
grant select on hold0 to authenticated;
set role authenticated;
select pg_temp.as_user(3);    -- a teammate can't edit
select pg_temp.expect_error($q$select public.edit_team_roster((pg_temp.reg(2, 'legacy')).id, array[pg_temp.u(3)], 'X')$q$, 'REGISTRATION_NOT_FOUND');
select pg_temp.as_user(6);    -- nor can a stranger
select pg_temp.expect_error($q$select public.edit_team_roster((pg_temp.reg(2, 'legacy')).id, array[pg_temp.u(6)], 'X')$q$, 'REGISTRATION_NOT_FOUND');
select pg_temp.as_user(2);
select pg_temp.expect_error($q$select public.edit_team_roster((pg_temp.reg(2, 'legacy')).id, array[pg_temp.u(3), pg_temp.u(5)], 'X')$q$, 'MEMBER_ALREADY_REGISTERED');
select pg_temp.expect_error($q$select public.edit_team_roster((pg_temp.reg(2, 'legacy')).id, array[pg_temp.u(3), pg_temp.u(13)], 'X')$q$, 'MEMBER_NOT_APPROVED');
select pg_temp.expect_error($q$select public.edit_team_roster((pg_temp.reg(2, 'legacy')).id, array[pg_temp.u(3), pg_temp.u(6), pg_temp.u(7)], 'X')$q$, 'TEAM_TOO_LARGE');
select pg_temp.expect_error($q$select public.edit_team_roster((pg_temp.reg(2, 'legacy')).id, array[pg_temp.u(3), pg_temp.u(4)], '')$q$, 'TEAM_NAME_REQUIRED');
-- no-op: same members, same name -> unchanged, no audit
select public.edit_team_roster((pg_temp.reg(2, 'legacy')).id, array[pg_temp.u(4), pg_temp.u(3)], repeat('N', 60));
reset role;
select pg_temp.check((select count(*) = 0 from public.payment_events where action = 'roster_edited'), '4: a no-op edit writes no audit row');
set role authenticated;
select pg_temp.as_user(2);
-- remove 04, keep 03, add 06 + 07? team max is 3 -> replace 04 by 06 and rename
select public.edit_team_roster((pg_temp.reg(2, 'legacy')).id, array[pg_temp.u(3), pg_temp.u(6)], 'Synapse Squad');
reset role;
select pg_temp.check(pg_temp.members(2, 'legacy') = '02,03,06' and (pg_temp.team(2, 'legacy')).name = 'Synapse Squad',
  '4: teammate replaced and team renamed');
select pg_temp.check((pg_temp.reg(4, 'legacy')).id is null, '4: the removed teammate''s registration is deleted');
select pg_temp.check((pg_temp.reg(2, 'legacy')).hold_expires_at = (select h from hold0)
                 and (pg_temp.reg(6, 'legacy')).hold_expires_at = (select h from hold0), '4: hold never extended; new teammate follows the head''s hold');
select pg_temp.check((select count(*) = 1 and bool_and(registration_id = (pg_temp.reg(2, 'legacy')).id
                        and note = 'Team edited: size 3 -> 3, added 1, removed 1, name changed, amount 40000'
                        and note !~ 'P[0-9]' and note !~ '[0-9a-f]{8}-')
                      from public.payment_events where action = 'roster_edited'), '4: audit row on the head''s registration, counts only');
-- shrink to 2 -> size-2 price; removed teammate is free to join another team
set role authenticated;
select pg_temp.as_user(2);
select public.edit_team_roster((pg_temp.reg(2, 'legacy')).id, array[pg_temp.u(3)], 'Synapse Squad');
select pg_temp.as_user(8);
select public.register_team(pg_temp.ev('legacy'), array[pg_temp.u(6)], 'Second team');
reset role;
select pg_temp.check((pg_temp.reg(2, 'legacy')).amount = 30000 and (pg_temp.reg(2, 'legacy')).list_price = 30000
                 and (pg_temp.reg(6, 'legacy')).team_id = (pg_temp.reg(8, 'legacy')).team_id, '4: price recomputed for 2; removed teammate joined another team');
-- the 3-arg blocks check ignores the caller's own team
select pg_temp.check(public.registration_blocks_new(pg_temp.u(3), pg_temp.ev('legacy'))
                 and not public.registration_blocks_new(pg_temp.u(3), pg_temp.ev('legacy'), (pg_temp.reg(2, 'legacy')).team_id),
  '4: a current teammate doesn''t count as "already registered" when editing');
-- capacity: growth is limited by max_participants
update public.events set max_participants = 6 where slug = 'legacy';   -- taken: 2 + 1 + 2 = 5
set role authenticated;
select pg_temp.as_user(2);
select pg_temp.expect_error($q$select public.edit_team_roster((pg_temp.reg(2, 'legacy')).id, array[pg_temp.u(3), pg_temp.u(9), pg_temp.u(10)], 'S')$q$, 'TEAM_TOO_LARGE');
select public.edit_team_roster((pg_temp.reg(2, 'legacy')).id, array[pg_temp.u(3), pg_temp.u(9)], 'S');   -- 6 = full
select pg_temp.as_user(8);
select pg_temp.expect_error($q$select public.edit_team_roster((pg_temp.reg(8, 'legacy')).id, array[pg_temp.u(6), pg_temp.u(10)], 'Second team')$q$, 'EVENT_FULL');
reset role;
update public.events set max_participants = null where slug = 'legacy';

-- ── 5. payment evidence (and every other non-editable state) locks it ──────
create or replace function pg_temp.try_edit() returns text language plpgsql as $$
begin
  perform public.edit_team_roster((pg_temp.reg(2, 'legacy')).id, array[pg_temp.u(3)], 'S');
  return 'EDITED';
exception when others then return sqlerrm;
end $$;
create or replace function pg_temp.locked_when(p_set text) returns boolean language plpgsql as $$
declare r text;
begin
  execute format('update public.registrations set %s where id = %L', p_set, (pg_temp.reg(2, 'legacy')).id);
  set local role authenticated;
  perform pg_temp.as_user(2);
  r := pg_temp.try_edit();
  reset role;
  return r = 'ROSTER_LOCKED';
end $$;
begin; select pg_temp.check(pg_temp.locked_when('payment_screenshot = ''shot.png'''), '5: screenshot locks'); rollback;
begin; select pg_temp.check(pg_temp.locked_when('transaction_id = ''UTR12345678'''), '5: UTR locks'); rollback;
begin; select pg_temp.check(pg_temp.locked_when('payment_status = ''uploaded'''), '5: uploaded locks'); rollback;
begin; select pg_temp.check(pg_temp.locked_when('payment_status = ''under_review'''), '5: under review locks'); rollback;
begin; select pg_temp.check(pg_temp.locked_when('payment_status = ''verified'', registration_status = ''confirmed'''), '5: verified locks'); rollback;
begin; select pg_temp.check(pg_temp.locked_when('registration_status = ''cancelled'''), '5: cancelled locks'); rollback;
begin; select pg_temp.check(pg_temp.locked_when('registration_status = ''rejected'''), '5: rejected locks'); rollback;
begin; select pg_temp.check(pg_temp.locked_when('hold_expires_at = now() - interval ''1 minute'''), '5: expired hold locks'); rollback;
-- real flow: submit payment, then the roster is frozen
set role authenticated;
select pg_temp.as_user(2);
select (public.submit_payment((pg_temp.reg(2, 'legacy')).id, 'UTR30303030', 'shot-legacy.png')).payment_status in ('uploaded', 'under_review');
select pg_temp.expect_error($q$select public.edit_team_roster((pg_temp.reg(2, 'legacy')).id, array[pg_temp.u(3)], 'S')$q$, 'ROSTER_LOCKED');
reset role;
select pg_temp.check(pg_temp.members(2, 'legacy') = '02,03,09' and (pg_temp.team(2, 'legacy')).name = 'S', '5: locked edit changed nothing');

-- ── 6. free size: editing to a ₹0 size confirms the team ───────────────────
insert into public.events (slug, title, registration_fee, team_fee, registration_open, is_live, team_enabled, team_max) values
  ('mixed', 'Mixed', 0, 20000, true, true, true, 3);
set role authenticated;
select pg_temp.as_user(10);
select public.register_team(pg_temp.ev('mixed'), array[pg_temp.u(11)], 'Pair');
select public.edit_team_roster((pg_temp.reg(10, 'mixed')).id, array[]::uuid[], null);
reset role;
select pg_temp.check((pg_temp.reg(10, 'mixed')).registration_status = 'confirmed' and (pg_temp.reg(10, 'mixed')).amount = 0
                 and (pg_temp.reg(11, 'mixed')).id is null and (pg_temp.team(10, 'mixed')).name is null, '6: shrinking to a free size confirms; solo team has no name');

select pg_temp.check((select public.member_count(t) = 3 from public.teams t where t.id = (pg_temp.reg(2, 'legacy')).team_id)
  and (select public.member_count(t) = 1 from public.teams t where t.id = (pg_temp.reg(5, 'legacy')).team_id), '6: member_count');

-- ── 7. grants ──────────────────────────────────────────────────────────────
select pg_temp.check(not has_function_privilege('anon', 'public.edit_team_roster(uuid,uuid[],text)', 'execute')
                 and has_function_privilege('authenticated', 'public.edit_team_roster(uuid,uuid[],text)', 'execute')
                 and not has_function_privilege('authenticated', 'public.registration_blocks_new(uuid,uuid,uuid)', 'execute')
                 and not has_function_privilege('authenticated', 'public.team_roster_editable(public.registrations)', 'execute')
                 and (select count(*) = 1 from pg_proc where proname = 'register_team'), '7: RPC grants; one register_team signature');

-- ── 8. social links ────────────────────────────────────────────────────────
select pg_temp.check(public.site_social_links_error('{}') is null
  and public.site_social_links_error('{"links":[{"platform":"instagram","url":"https://www.instagram.com/wissendurst27","enabled":true},{"platform":"x","url":"https://twitter.com/w27","enabled":false},{"platform":"website","url":"https://wissendurst27.vercel.app/about","enabled":true}]}') is null,
  '8: valid links accepted');
select pg_temp.check(public.site_social_links_error('{"links":[{"platform":"tiktok","url":"https://tiktok.com/x","enabled":true}]}') = 'INVALID_PLATFORM', '8: platform allowlist');
select pg_temp.check(public.site_social_links_error('{"links":[{"platform":"facebook","url":"http://facebook.com/x","enabled":true}]}') = 'INVALID_URL', '8: https only');
select pg_temp.check(public.site_social_links_error('{"links":[{"platform":"website","url":"javascript:alert(1)","enabled":true}]}') = 'INVALID_URL', '8: no javascript: URLs');
select pg_temp.check(public.site_social_links_error('{"links":[{"platform":"x","url":"https://instagram.com/x","enabled":true}]}') = 'HOST_NOT_ALLOWED', '8: per-platform host');
select pg_temp.check(public.site_social_links_error('{"links":[{"platform":"instagram","url":"https://instagram.com.evil.io/x","enabled":true}]}') = 'HOST_NOT_ALLOWED', '8: look-alike host refused');
select pg_temp.check(public.site_social_links_error('{"links":[{"platform":"x","url":"https://x.com/a","enabled":"yes"}]}') = 'INVALID_ENABLED', '8: enabled must be boolean');
select pg_temp.check(public.site_social_links_error(jsonb_build_object('links', (select jsonb_agg(jsonb_build_object('platform','website','url','https://a.org/'||n,'enabled',true)) from generate_series(1,6) n))) = 'TOO_MANY_LINKS', '8: at most five');
select pg_temp.check(public.site_social_links_error('{"links":[],"extra":1}') = 'UNKNOWN_KEY', '8: unknown keys refused');
insert into public.site_settings (id) values (1) on conflict (id) do nothing;
select pg_temp.expect_error($q$update public.site_settings set social = '{"links":[{"platform":"x","url":"http://x.com","enabled":true}]}'$q$, 'site_settings_social_valid');
set role authenticated;
select pg_temp.as_user(1);   -- content admin
update public.site_settings set social = '{"links":[{"platform":"instagram","url":"https://instagram.com/w27","enabled":true}]}' where id = 1;
select pg_temp.as_user(2);   -- participant: RLS filters the row out
update public.site_settings set social = '{}' where id = 1;
reset role;
select pg_temp.check((select social->'links'->0->>'platform' = 'instagram' from public.site_settings where id = 1), '8: content admins save; participants can''t');

-- ── 9. re-run is safe ──────────────────────────────────────────────────────
create temp table before_rerun as select (select string_agg(event_id || ':' || team_size || ':' || fee, ',' order by event_id, team_size) from public.event_team_price_tiers) t;
\ir ../migrations/0030_team_pricing_roster_social.sql
select pg_temp.check((select t from before_rerun) = (select string_agg(event_id || ':' || team_size || ':' || fee, ',' order by event_id, team_size) from public.event_team_price_tiers), '9: re-run keeps every price');
select 'ALL 0030 TESTS PASSED';
