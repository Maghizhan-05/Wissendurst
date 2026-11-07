#!/usr/bin/env bash
# Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
# 0031 concurrency (participant-id release on sign-up rejection):
#   A. a rejection releasing an E id races an approval: the approval waits for
#      the release to commit and then takes the released (lowest) number;
#   B. two approvals race for one released number: exactly one gets it, the
#      other gets a fresh number — never the same id twice;
#   C. a resubmission racing the admin's rejection lands after it (never lost).
set -euo pipefail
: "${PSQL_CMD:?PSQL_CMD must be set by scripts/test-db.sh}"
run() { $PSQL_CMD -t -A -v ON_ERROR_STOP=1 "$@"; }
pass() { echo "PASS $1"; }
fail() { echo "FAIL: $1"; exit 1; }
u() { printf '00000000-0000-0000-0000-0000000032%02d' "$1"; }

run >/dev/null -c "grant all on all tables in schema public to anon, authenticated, service_role"
run >/dev/null <<SQL
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000032' || lpad(n::text, 2, '0'))::uuid, 'k'||n||'@x.test' from generate_series(0, 9) n;
update public.profiles set approval_status = 'approved', role = 'admin', admin_scopes = array['signups'] where id = '$(u 0)';
update public.profiles set id_card_path = id::text || '/a.png' where role = 'user';
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
pid() { run -c "select coalesce(participant_id, '-') from public.profiles where id = '$1'"; }

# Legacy shape: two pending profiles that already hold E ids.
as_tx "$(u 0)" "select public.admin_set_approval('$(u 1)', 'approved')" 0 >/dev/null
as_tx "$(u 0)" "select public.admin_set_approval('$(u 2)', 'approved')" 0 >/dev/null
run >/dev/null -c "update public.profiles set approval_status = 'pending' where id in ('$(u 1)', '$(u 2)')"
P1=$(pid "$(u 1)"); P2=$(pid "$(u 2)")

# A
( as_tx "$(u 0)" "select public.admin_set_approval('$(u 1)', 'rejected')" 1.5 >/dev/null 2>&1 || true ) & p1=$!
sleep 0.4
as_tx "$(u 0)" "select public.admin_set_approval('$(u 3)', 'approved')" 0 >/dev/null
wait $p1
[ "$(pid "$(u 1)")" = "-" ] && [ "$(pid "$(u 3)")" = "$P1" ] \
  && pass "A: approval waited for the release and took the released number" \
  || fail "A: u1=$(pid "$(u 1)") u3=$(pid "$(u 3)") wanted $P1"

# B
as_tx "$(u 0)" "select public.admin_set_approval('$(u 2)', 'rejected')" 0 >/dev/null
( as_tx "$(u 0)" "select public.admin_set_approval('$(u 4)', 'approved')" 1.0 >/dev/null 2>&1 || true ) & p1=$!
sleep 0.2
as_tx "$(u 0)" "select public.admin_set_approval('$(u 5)', 'approved')" 0 >/dev/null
wait $p1
A4=$(pid "$(u 4)"); A5=$(pid "$(u 5)")
dups=$(run -c "select count(*) from (select participant_id from public.profiles where participant_id is not null group by 1 having count(*) > 1) d")
[ "$A4" != "$A5" ] && [ "$dups" = "0" ] && { [ "$A4" = "$P2" ] || [ "$A5" = "$P2" ]; } \
  && pass "B: one approval got the released number, the other a fresh one; no duplicates" \
  || fail "B: u4=$A4 u5=$A5 released=$P2 dups=$dups"

# C
run >/dev/null -c "insert into storage.objects (bucket_id, name) values ('id-cards', '$(u 6)/b.png')"
( as_tx "$(u 0)" "select public.admin_set_approval('$(u 6)', 'rejected')" 1.5 >/dev/null 2>&1 || true ) & p1=$!
sleep 0.4
out=$(as_tx "$(u 6)" "select public.resubmit_my_application('K Six', '9999999999', 'College', 'MBBS', '2nd', '$(u 6)/b.png')" 0 || true)
wait $p1
st=$(run -c "select approval_status from public.profiles where id = '$(u 6)'")
hist=$(run -c "select string_agg(from_status || '>' || to_status, ',' order by id) from public.profile_approval_events where profile_id = '$(u 6)'")
[ "$st" = "pending" ] && [ "$hist" = "pending>rejected,rejected>pending" ] \
  && pass "C: resubmission waited for the rejection, then returned the application to pending" \
  || fail "C: status=$st history=$hist out=$out"
