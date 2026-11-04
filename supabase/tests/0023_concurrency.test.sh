#!/usr/bin/env bash
# Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
# 0023 concurrency:
#   A. the same UTR submitted at the same moment as an EVENT payment and as a
#      GENERAL REGISTRATION payment (both orders) -> exactly one winner;
#   B. two admins verify the same GR payment at once -> one E -> GR conversion;
#   C. two different conversions + a new E approval at once -> distinct GR ids,
#      consistent allocations, released E number reused at most once.
set -euo pipefail
: "${PSQL_CMD:?PSQL_CMD must be set by scripts/test-db.sh}"
run() { $PSQL_CMD -t -A -v ON_ERROR_STOP=1 "$@"; }
pass() { echo "PASS $1"; }
fail() { echo "FAIL: $1"; exit 1; }
u() { printf '00000000-0000-0000-0000-0000000009%02d' "$1"; }
MIGS="$(cd "$(dirname "$0")/.." && pwd)/migrations"

# Supabase's default grants, then the migrations' revokes on top (as on live).
run >/dev/null -c "grant all on all tables in schema public to anon, authenticated, service_role" \
               -c "grant execute on all functions in schema public to anon, authenticated"
for m in 0021_participant_id_allocator 0022_profile_update_lockdown 0023_general_registration; do
  run >/dev/null 2>&1 -f "$MIGS/$m.sql"
done

run >/dev/null <<SQL
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000009' || lpad(n::text, 2, '0'))::uuid, 'c' || n || '@x.test' from generate_series(0, 12) n;
update public.profiles set approval_status = 'approved', role = 'admin', admin_scopes = array['payments','signups'] where id = '$(u 0)';
update public.profiles set approval_status = 'approved', role = 'admin', admin_scopes = array['payments'] where id = '$(u 1)';
select public.participant_id_allocate(('00000000-0000-0000-0000-0000000009' || lpad(n::text, 2, '0'))::uuid, 'E') from generate_series(2, 10) n;
update public.profiles set approval_status = 'approved' where participant_id is not null;
update public.general_registration_settings set enabled = true, fee = 1000, upi_id = 'gr@okbank', payee_name = 'GR';
insert into public.events (slug, title, registration_fee, registration_open, is_live) values ('pay', 'Pay', 500, true, true);
SQL

in_tx() { # $1 user, $2 sql, $3 sleep — runs as authenticated inside a lingering transaction
  run 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$1', true);
$2;
select pg_sleep($3);
commit;
SQL
}
setup_pair() { # $1 event user, $2 gr user
  run >/dev/null <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', '$1', false);
select public.register_for_event((select id from public.events where slug = 'pay'));
select set_config('request.jwt.claim.sub', '$2', false);
select public.start_general_registration();
SQL
}
EVT_SUBMIT="select public.submit_payment((select id from public.registrations where profile_id = auth.uid()), '%s', null)"
GR_SUBMIT="select public.submit_general_registration_payment('%s', null)"

race() { # $1 label, $2 event user, $3 gr user, $4 utr, $5 first ("event"|"gr")
  setup_pair "$2" "$3"
  local e g
  e=$(printf "$EVT_SUBMIT" "$4"); g=$(printf "$GR_SUBMIT" "$4")
  if [ "$5" = event ]; then
    ( in_tx "$2" "$e" 1.5 >/dev/null ) & p1=$!; sleep 0.4; ( in_tx "$3" "$g" 0 >/dev/null ) & p2=$!
  else
    ( in_tx "$3" "$g" 1.5 >/dev/null ) & p1=$!; sleep 0.4; ( in_tx "$2" "$e" 0 >/dev/null ) & p2=$!
  fi
  wait $p1; wait $p2
  local res
  res=$(run -c "select (select payment_status from public.registrations where profile_id = '$2') || ',' || (select status from public.general_registrations where profile_id = '$3') || ',' || (select count(*) from public.payment_utr_claims where utr = '$4')")
  if [ "$5" = event ]; then want="under_review,duplicate,1"; else want="duplicate,under_review,1"; fi
  [ "$res" = "$want" ] && pass "$1: one winner ($res)" || fail "$1: got $res want $want"
}

race "A1 event first, GR second" "$(u 2)" "$(u 3)" "UTR700001" event
race "A2 GR first, event second" "$(u 4)" "$(u 5)" "UTR700002" gr

# ── B. two admins verify the same GR payment concurrently ───────────────────
run >/dev/null <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', '$(u 6)', false);
select public.start_general_registration();
select public.submit_general_registration_payment('UTR700003', null);
SQL
GR6=$(run -c "select id from public.general_registrations where profile_id = '$(u 6)'")
( in_tx "$(u 0)" "select public.admin_review_general_registration('$GR6', 'verified')" 1.5 >/dev/null ) & p1=$!
sleep 0.4
( in_tx "$(u 1)" "select public.admin_review_general_registration('$GR6', 'verified')" 0 >/dev/null ) & p2=$!
wait $p1 || fail "B: first verification errored"; wait $p2 || fail "B: second verification errored"
res=$(run -c "select (select participant_id from public.profiles where id = '$(u 6)') || ',' || (select count(*) from public.participant_id_history where profile_id = '$(u 6)' and namespace = 'GR') || ',' || (select next_number from public.participant_id_namespaces where namespace = 'GR') || ',' || (select count(*) from public.general_registration_payment_events where profile_id = '$(u 6)' and to_status = 'verified')")
[ "$res" = "W27/GR/0001,1,2,1" ] && pass "B: concurrent double verification -> exactly one conversion ($res)" || fail "B: $res"

# ── C. two conversions + one new approval at once ──────────────────────────
for n in 7 8; do run >/dev/null <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', '$(u $n)', false);
select public.start_general_registration();
select public.submit_general_registration_payment('UTR70001$n', null);
SQL
done
G7=$(run -c "select id from public.general_registrations where profile_id = '$(u 7)'")
G8=$(run -c "select id from public.general_registrations where profile_id = '$(u 8)'")
( in_tx "$(u 0)" "select public.admin_review_general_registration('$G7', 'verified')" 0.5 >/dev/null ) & p1=$!
( in_tx "$(u 1)" "select public.admin_review_general_registration('$G8', 'verified')" 0.5 >/dev/null ) & p2=$!
( in_tx "$(u 0)" "select public.admin_set_approval('$(u 11)', 'approved')" 0.5 >/dev/null ) & p3=$!
wait $p1 || fail "C: conversion 7 errored"; wait $p2 || fail "C: conversion 8 errored"; wait $p3 || fail "C: approval errored"
res=$(run -c "select (select string_agg(participant_id, ',' order by participant_id) from public.profiles where id in ('$(u 7)', '$(u 8)'))")
[ "$res" = "W27/GR/0002,W27/GR/0003" ] && pass "C: concurrent conversions got distinct GR ids ($res)" || fail "C: GR ids $res"
res=$(run -c "select count(*) from public.profiles p left join public.participant_id_allocations a on a.profile_id = p.id where p.participant_id is distinct from a.participant_id")
[ "$res" = "0" ] && pass "C: allocations and profiles consistent" || fail "C: $res inconsistent profiles"
res=$(run -c "select (select count(*) from public.participant_id_allocations where namespace = 'E') + (select count(*) from public.participant_id_released where namespace = 'E') || '=' || (select next_number - 1 from public.participant_id_namespaces where namespace = 'E')")
[ "${res%%=*}" = "${res##*=}" ] && pass "C: every E number is either allocated or released, none lost or doubled ($res)" || fail "C: E accounting $res"
