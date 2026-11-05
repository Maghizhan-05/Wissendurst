#!/usr/bin/env bash
# Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
# 0024 concurrency: two super admins promoting at the same moment.
#   A. different users -> distinct admin numbers, lowest released first;
#   B. the same user from both supers -> exactly one staff allocation;
#   C. a promotion racing a participant approval -> consistent pools.
set -euo pipefail
: "${PSQL_CMD:?PSQL_CMD must be set by scripts/test-db.sh}"
run() { $PSQL_CMD -t -A -v ON_ERROR_STOP=1 "$@"; }
pass() { echo "PASS $1"; }
fail() { echo "FAIL: $1"; exit 1; }
u() { printf '00000000-0000-0000-0000-0000000011%02d' "$1"; }
MIGS="$(cd "$(dirname "$0")/.." && pwd)/migrations"

run >/dev/null -c "grant all on all tables in schema public to anon, authenticated, service_role" \
               -c "grant execute on all functions in schema public to anon, authenticated"
run >/dev/null -c "drop function if exists public.set_my_profile_photo(text)"
for m in 0021_participant_id_allocator 0022_profile_update_lockdown 0023_general_registration 0024_staff_participant_ids 0026_review_hardening; do
  run >/dev/null 2>&1 -f "$MIGS/$m.sql"
done
run >/dev/null -c "update public.payment_destination_settings set default_event_upi_id = 'site.default@okbank'"

run >/dev/null <<SQL
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000011' || lpad(n::text, 2, '0'))::uuid, 'k' || n || '@x.test' from generate_series(1, 12) n;
update public.profiles set approval_status = 'approved' where id <> '$(u 12)';
select public.participant_id_sync_role(('00000000-0000-0000-0000-0000000011' || lpad(n::text, 2, '0'))::uuid) from generate_series(1, 11) n;
update public.profiles set role = 'admin', is_super_admin = true, admin_scopes = array['signups','events','payments','content'] where id in ('$(u 1)', '$(u 2)');
select public.participant_id_sync_role('$(u 1)'); select public.participant_id_sync_role('$(u 2)');
SQL
# supadmin/01, /02 taken; E0001, E0002 released; users 3..11 hold E0003..E0011

in_tx() { # $1 actor, $2 sql, $3 sleep
  run 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$1', true);
$2;
select pg_sleep($3);
commit;
SQL
}

# A. two supers promote two different users at once
( in_tx "$(u 1)" "select public.super_set_admin('$(u 3)', 'admin', false, array['events'])" 1 >/dev/null ) & p1=$!
sleep 0.3
( in_tx "$(u 2)" "select public.super_set_admin('$(u 4)', 'admin', false, array['events'])" 0 >/dev/null ) & p2=$!
wait $p1 || fail "A: first promotion errored"; wait $p2 || fail "A: second promotion errored"
res=$(run -c "select string_agg(participant_id, ',' order by participant_id) from public.profiles where id in ('$(u 3)', '$(u 4)')")
[ "$res" = "admin/01,admin/02" ] && pass "A: concurrent promotions got distinct ids ($res)" || fail "A: $res"

# B. both supers promote the same user to super admin at once
( in_tx "$(u 1)" "select public.super_set_admin('$(u 5)', 'admin', true, array['events'])" 1 >/dev/null ) & p1=$!
sleep 0.3
( in_tx "$(u 2)" "select public.super_set_admin('$(u 5)', 'admin', true, array['events'])" 0 >/dev/null ) & p2=$!
wait $p1 || fail "B: first errored"; wait $p2 || fail "B: second errored"
res=$(run -c "select (select participant_id from public.profiles where id = '$(u 5)') || ',' || (select count(*) from public.participant_id_history where profile_id = '$(u 5)' and namespace = 'SUPADMIN') || ',' || (select next_number from public.participant_id_namespaces where namespace = 'SUPADMIN')")
[ "$res" = "supadmin/03,1,4" ] && pass "B: same-user double promotion -> one allocation ($res)" || fail "B: $res"

# C. a demotion (releasing admin/01 -> back to E) racing an approval of a new participant
( in_tx "$(u 1)" "select public.super_set_admin('$(u 3)', 'user', false, null)" 1 >/dev/null ) & p1=$!
sleep 0.3
( in_tx "$(u 1)" "select public.admin_set_approval('$(u 12)', 'approved')" 0 >/dev/null ) & p2=$!
wait $p1 || fail "C: demotion errored"; wait $p2 || fail "C: approval errored"
res=$(run -c "select count(*) from public.profiles p left join public.participant_id_allocations a on a.profile_id = p.id where p.participant_id is distinct from a.participant_id")
[ "$res" = "0" ] && pass "C: profiles and allocations consistent after the race" || fail "C: $res mismatches"
res=$(run -c "select string_agg(participant_id, ',' order by participant_id) from public.profiles where id in ('$(u 3)', '$(u 12)')")
[ "$res" = "W27/E/0001,W27/E/0002" ] && pass "C: both took the lowest released E numbers ($res)" || fail "C: $res"
res=$(run -c "select string_agg(namespace || ':' || number, ',' order by namespace, number) from public.participant_id_released")
[ "$res" = "ADMIN:1,E:3,E:4,E:5" ] && pass "C: pools hold exactly admin/01 and W27/E/0003-0005 ($res)" || fail "C: pools $res"
