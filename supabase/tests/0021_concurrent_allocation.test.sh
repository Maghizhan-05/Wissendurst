#!/usr/bin/env bash
# Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
# 0021 concurrency: admins approving at the same moment must get distinct
# numbers (the namespace row lock serialises allocation), the lowest released
# number goes to exactly one of them, and two admins approving the SAME user
# concurrently produce exactly one id and one history row.
set -euo pipefail
: "${PSQL_CMD:?PSQL_CMD must be set by scripts/test-db.sh}"
run() { $PSQL_CMD -t -A -v ON_ERROR_STOP=1 "$@"; }

ADMIN=00000000-0000-0000-0000-000000000400
U=(00000000-0000-0000-0000-000000000401 00000000-0000-0000-0000-000000000402
   00000000-0000-0000-0000-000000000403 00000000-0000-0000-0000-000000000404
   00000000-0000-0000-0000-000000000405 00000000-0000-0000-0000-000000000406)
SAME=00000000-0000-0000-0000-000000000407
OLD=00000000-0000-0000-0000-000000000408

run >/dev/null <<SQL
insert into auth.users (id, email) values ('$ADMIN','adm@x.test'), ('$SAME','same@x.test'), ('$OLD','old@x.test');
insert into auth.users (id, email) select u::uuid, u || '@x.test' from unnest(array['${U[0]}','${U[1]}','${U[2]}','${U[3]}','${U[4]}','${U[5]}']) u;
update public.profiles set role = 'admin', admin_scopes = array['signups'], approval_status = 'approved' where id = '$ADMIN';
select public.participant_id_allocate('$ADMIN', 'E');   -- W27/E/0001
select public.participant_id_allocate('$OLD', 'E');     -- W27/E/0002
select public.participant_id_release('$OLD', 'E');      -- 0002 becomes reusable
SQL

approve() { # $1 user — approve inside a transaction that lingers briefly
  run >/dev/null 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$ADMIN', true);
select public.admin_set_approval('$1', 'approved');
select pg_sleep(0.3);
commit;
SQL
}

pids=()
for u in "${U[@]}" "$SAME" "$SAME" "$SAME"; do approve "$u" & pids+=($!); done
fails=0
for p in "${pids[@]}"; do wait "$p" || fails=$((fails + 1)); done

pass() { echo "PASS $1"; }
fail() { echo "FAIL: $1"; exit 1; }

[ "$fails" -eq 0 ] && pass "9 concurrent approvals all committed" || fail "$fails approvals errored"

ids=$(run -c "select string_agg(participant_id, ',' order by participant_id) from public.profiles where id in ('${U[0]}','${U[1]}','${U[2]}','${U[3]}','${U[4]}','${U[5]}','$SAME')")
[ "$ids" = "W27/E/0002,W27/E/0003,W27/E/0004,W27/E/0005,W27/E/0006,W27/E/0007,W27/E/0008" ] \
  && pass "7 users got 7 distinct ids: released 0002 reused once, then 0003-0008" || fail "unexpected ids: $ids"

same=$(run -c "select count(*) from public.participant_id_history where profile_id = '$SAME'")
[ "$same" = "1" ] && pass "same user approved 3x concurrently -> exactly one allocation" || fail "same-user history rows: $same"

state=$(run -c "select (select next_number from public.participant_id_namespaces where namespace='E') || ' ' || (select count(*) from public.participant_id_released) || ' ' || (select count(*) from public.participant_id_allocations a join public.profiles p on p.id = a.profile_id where p.participant_id = a.participant_id) || ' ' || (select count(*) from public.profiles where participant_id is not null)")
[ "$state" = "9 0 8 8" ] && pass "counter=9, pool empty, allocations and profiles consistent" || fail "state: $state"
