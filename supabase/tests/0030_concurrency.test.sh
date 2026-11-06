#!/usr/bin/env bash
# Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
# 0030 concurrency (per-event lock):
#   A. roster edit vs payment submission on the same team -> exactly one wins:
#      either the edit lands and the payment follows it, or payment lands first
#      and the edit is refused with ROSTER_LOCKED;
#   B. two heads adding the same person at once -> only one team gets them;
#   C. pricing change while a team registers -> the team pays a price that
#      existed (old or new), never a mix.
set -euo pipefail
: "${PSQL_CMD:?PSQL_CMD must be set by scripts/test-db.sh}"
run() { $PSQL_CMD -t -A -v ON_ERROR_STOP=1 "$@"; }
pass() { echo "PASS $1"; }
fail() { echo "FAIL: $1"; exit 1; }
u() { printf '00000000-0000-0000-0000-0000000019%02d' "$1"; }

run >/dev/null -c "grant all on all tables in schema public to anon, authenticated, service_role" \
               -c "grant execute on all functions in schema public to anon, authenticated"
run >/dev/null <<SQL
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000019' || lpad(n::text, 2, '0'))::uuid, 'c'||n||'@x.test' from generate_series(0, 9) n;
update public.profiles set approval_status = 'approved';
update public.profiles set role = 'admin', admin_scopes = array['events'] where id = '$(u 0)';
insert into public.events (slug, title, registration_fee, team_fee, registration_open, is_live, team_enabled, team_max)
values ('ca', 'A', 10000, 20000, true, true, true, 3), ('cb', 'B', 10000, 20000, true, true, true, 3), ('cc', 'C', 10000, 20000, true, true, true, 3);
SQL
as_tx() { # $1 user, $2 sql, $3 sleep before commit
  run 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$1', true);
$2;
select pg_sleep($3);
commit;
SQL
}
ev() { run -c "select id from public.events where slug = '$1'"; }
reg() { run -c "select id from public.registrations where profile_id = '$1' and event_id = (select id from public.events where slug = '$2')"; }

# A
as_tx "$(u 1)" "select public.register_team('$(ev ca)', array['$(u 2)']::uuid[], 'Alpha')" 0 >/dev/null
R=$(reg "$(u 1)" ca)
( as_tx "$(u 1)" "select public.edit_team_roster('$R', array['$(u 2)','$(u 3)']::uuid[], 'Alpha')" 1.5 >/dev/null 2>&1 || true ) & p1=$!
sleep 0.4
pay=$(as_tx "$(u 1)" "select (public.submit_payment('$R', 'UTR40404040', 'shot.png')).amount" 0 || true)
wait $p1
amount=$(run -c "select amount from public.registrations where id = '$R'")
size=$(run -c "select count(*) from public.registrations where team_id = (select team_id from public.registrations where id = '$R')")
[ "$amount" = "20000" ] && [ "$size" = "3" ] && grep -q "20000" <<<"$pay" \
  && pass "A: edit committed first, payment waited and used the new size-3 amount" \
  || fail "A: amount=$amount size=$size pay=$pay"
# A2: payment first, edit after -> locked
as_tx "$(u 4)" "select public.register_team('$(ev cb)', array['$(u 5)']::uuid[], 'Beta')" 0 >/dev/null
R2=$(reg "$(u 4)" cb)
( as_tx "$(u 4)" "select public.submit_payment('$R2', 'UTR50505050', 'shot2.png')" 1.5 >/dev/null 2>&1 || true ) & p1=$!
sleep 0.4
out=$(as_tx "$(u 4)" "select public.edit_team_roster('$R2', array['$(u 5)','$(u 6)']::uuid[], 'Beta')" 0 || true)
wait $p1
grep -q ROSTER_LOCKED <<<"$out" && pass "A2: payment committed first, the waiting edit is refused (ROSTER_LOCKED)" || fail "A2: $out"

# B
as_tx "$(u 7)" "select public.register_team('$(ev cc)', array[]::uuid[], null)" 0 >/dev/null
as_tx "$(u 8)" "select public.register_team('$(ev cc)', array[]::uuid[], null)" 0 >/dev/null
R7=$(reg "$(u 7)" cc); R8=$(reg "$(u 8)" cc)
( as_tx "$(u 7)" "select public.edit_team_roster('$R7', array['$(u 9)']::uuid[], 'Gamma')" 1.5 >/dev/null 2>&1 || true ) & p1=$!
sleep 0.4
out=$(as_tx "$(u 8)" "select public.edit_team_roster('$R8', array['$(u 9)']::uuid[], 'Delta')" 0 || true)
wait $p1
n=$(run -c "select count(*) from public.registrations where profile_id = '$(u 9)' and event_id = '$(ev cc)'")
grep -q MEMBER_ALREADY_REGISTERED <<<"$out" && [ "$n" = "1" ] && pass "B: the same person can't be added to two teams at once" || fail "B: n=$n out=$out"

# C
( as_tx "$(u 0)" "select public.admin_set_event_pricing('$(ev cb)', null, true, 1, 3, '[11000,33000,44000]')" 1.5 >/dev/null 2>&1 || true ) & p1=$!
sleep 0.4
as_tx "$(u 6)" "select public.register_team('$(ev cb)', array['$(u 3)']::uuid[], 'Late')" 0 >/dev/null || true
wait $p1
amt=$(run -c "select amount from public.registrations where profile_id = '$(u 6)' and event_id = '$(ev cb)'")
[ "$amt" = "33000" ] && pass "C: registration waited for the price change and used the new size-2 price" || fail "C: amount=$amt"
