#!/usr/bin/env bash
# Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
# 0036 concurrency (per-event lock): the lock winner succeeds, the loser gets a
# safe state error, and nothing is half-written.
#   A.  payment first, withdrawal waits        -> NOT_CANCELLABLE, payment kept
#   A2. withdrawal first, payment waits        -> payment refused, row cancelled
#   B.  head withdrawal first, roster edit waits -> ROSTER_LOCKED, team cancelled
#   C.  two heads absorb the same solo at once -> exactly one team gets them
#   D.  absorption first, owner withdrawal waits -> NOT_TEAM_HEAD (now a teammate)
#   D2. owner withdrawal first, absorption waits -> cancelled row re-used normally
set -euo pipefail
: "${PSQL_CMD:?PSQL_CMD must be set by scripts/test-db.sh}"
run() { $PSQL_CMD -t -A -v ON_ERROR_STOP=1 "$@"; }
pass() { echo "PASS $1"; }
fail() { echo "FAIL: $(tr '\n' ' ' <<<"$1")"; exit 1; }
u() { printf '00000000-0000-0000-0000-0000000036%02d' "$1"; }

run >/dev/null -c "grant all on all tables in schema public to anon, authenticated, service_role"
run >/dev/null <<SQL
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000036' || lpad(n::text, 2, '0'))::uuid, 'k'||n||'@x.test' from generate_series(0, 19) n;
update public.profiles set approval_status = 'approved';
insert into public.events (slug, title, registration_fee, team_fee, registration_open, is_live, team_enabled, team_max)
values ('cs', 'Solo', 10000, 0, true, true, false, 4),
       ('ct', 'Team', 10000, 20000, true, true, true, 4);
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
q() { run -c "$1"; }

# A: payment first
as_tx "$(u 1)" "select public.register_for_event('$(ev cs)')" 0 >/dev/null
R=$(reg "$(u 1)" cs)
( as_tx "$(u 1)" "select public.submit_payment('$R', 'UTR36010101', 'p/a.png')" 1.5 >/dev/null 2>&1 || true ) & p1=$!
sleep 0.4
out=$(as_tx "$(u 1)" "select public.cancel_my_registration('$R')" 0 || true)
wait $p1
st=$(q "select registration_status || ':' || payment_status from public.registrations where id = '$R'")
wd=$(q "select count(*) from public.payment_events where registration_id = '$R' and action like '%withdrawn'")
grep -q NOT_CANCELLABLE <<<"$out" && [ "$st" = "pending:under_review" ] && [ "$wd" = "0" ] \
  && pass "A: payment committed first; the waiting withdrawal is refused (NOT_CANCELLABLE), no audit" \
  || fail "A: out=$out st=$st wd=$wd"

# A2: withdrawal first
as_tx "$(u 2)" "select public.register_for_event('$(ev cs)')" 0 >/dev/null
R=$(reg "$(u 2)" cs)
( as_tx "$(u 2)" "select public.cancel_my_registration('$R')" 1.5 >/dev/null 2>&1 || true ) & p1=$!
sleep 0.4
out=$(as_tx "$(u 2)" "select public.submit_payment('$R', 'UTR36020202', 'p/a2.png')" 0 || true)
wait $p1
st=$(q "select registration_status || ':' || payment_status || ':' || (payment_screenshot is null) || ':' || (transaction_id is null) from public.registrations where id = '$R'")
grep -q "ERROR" <<<"$out" && [ "$st" = "cancelled:unpaid:true:true" ] \
  && pass "A2: withdrawal committed first; the waiting payment is refused and leaves no evidence" \
  || fail "A2: out=$out st=$st"

# B: head withdrawal first, edit waits
as_tx "$(u 3)" "select public.register_team('$(ev ct)', array['$(u 4)']::uuid[], 'Bee')" 0 >/dev/null
R=$(reg "$(u 3)" ct)
( as_tx "$(u 3)" "select public.cancel_my_registration('$R')" 1.5 >/dev/null 2>&1 || true ) & p1=$!
sleep 0.4
out=$(as_tx "$(u 3)" "select public.edit_team_roster('$R', array['$(u 4)','$(u 5)']::uuid[], 'Bee')" 0 || true)
wait $p1
st=$(q "select string_agg(registration_status::text, ',' order by profile_id) from public.registrations where team_id = (select team_id from public.registrations where id = '$R')")
grep -q ROSTER_LOCKED <<<"$out" && [ "$st" = "cancelled,cancelled" ] && [ -z "$(reg "$(u 5)" ct)" ] \
  && pass "B: head withdrawal committed first; the waiting edit is refused (ROSTER_LOCKED), nobody added" \
  || fail "B: out=$out st=$st"

# C: two heads absorb the same solo
as_tx "$(u 6)" "select public.register_team('$(ev ct)', array[]::uuid[], null)" 0 >/dev/null
S=$(reg "$(u 6)" ct)
( as_tx "$(u 7)" "select public.register_team('$(ev ct)', array['$(u 6)']::uuid[], 'Cee')" 1.5 >/dev/null 2>&1 || true ) & p1=$!
sleep 0.4
out=$(as_tx "$(u 8)" "select public.register_team('$(ev ct)', array['$(u 6)']::uuid[], 'Dee')" 0 || true)
wait $p1
teams=$(q "select count(distinct team_id) from public.registrations where profile_id = '$(u 6)'")
host=$(q "select (select profile_id from public.registrations h where h.team_id = r.team_id and h.is_team_head) = '$(u 7)' and r.id = '$S' from public.registrations r where r.profile_id = '$(u 6)'")
grep -q MEMBER_ALREADY_REGISTERED <<<"$out" && [ "$teams" = "1" ] && [ "$host" = "t" ] && [ -z "$(reg "$(u 8)" ct)" ] \
  && pass "C: the first head absorbs the solo (same row); the second is refused with no rows" \
  || fail "C: out=$out teams=$teams host=$host"

# D: absorption first, owner withdrawal waits
as_tx "$(u 9)" "select public.register_team('$(ev ct)', array[]::uuid[], null)" 0 >/dev/null
S=$(reg "$(u 9)" ct)
( as_tx "$(u 10)" "select public.register_team('$(ev ct)', array['$(u 9)']::uuid[], 'Eee')" 1.5 >/dev/null 2>&1 || true ) & p1=$!
sleep 0.4
out=$(as_tx "$(u 9)" "select public.cancel_my_registration('$S')" 0 || true)
wait $p1
st=$(q "select registration_status || ':' || is_team_head from public.registrations where id = '$S'")
grep -q NOT_TEAM_HEAD <<<"$out" && [ "$st" = "pending:false" ] \
  && pass "D: absorbed first; the waiting withdrawal is refused (NOT_TEAM_HEAD) and the team is intact" \
  || fail "D: out=$out st=$st"

# D2: owner withdrawal first, absorption waits
as_tx "$(u 11)" "select public.register_team('$(ev ct)', array[]::uuid[], null)" 0 >/dev/null
S=$(reg "$(u 11)" ct)
( as_tx "$(u 11)" "select public.cancel_my_registration('$S')" 1.5 >/dev/null 2>&1 || true ) & p1=$!
sleep 0.4
out=$(as_tx "$(u 12)" "select (public.register_team('$(ev ct)', array['$(u 11)']::uuid[], 'Eff')).id" 0 || true)
wait $p1
st=$(q "select registration_status || ':' || is_team_head from public.registrations where id = '$S'")
acts=$(q "select string_agg(action, ',' order by created_at, action) from public.payment_events where registration_id = '$S'")
! grep -q ERROR <<<"$out" && [ "$st" = "pending:false" ] && [ "$acts" = "team_intent_withdrawn,intent_refreshed" ] \
  && pass "D2: withdrawn first; the waiting team add re-uses the cancelled row as an ordinary refresh" \
  || fail "D2: out=$out st=$st acts=$acts"
