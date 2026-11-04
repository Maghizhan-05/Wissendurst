#!/usr/bin/env bash
# Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
# 0021 backfill guards: re-applying the migration over a malformed id, an id
# claimed by another owner, or an id sitting in the released pool must abort
# the whole transaction and leave every row untouched.
set -euo pipefail
: "${PSQL_CMD:?PSQL_CMD must be set by scripts/test-db.sh}"
MIG="$(cd "$(dirname "$0")/.." && pwd)/migrations/0021_participant_id_allocator.sql"
run() { $PSQL_CMD -t -A -v ON_ERROR_STOP=1 "$@"; }
pass() { echo "PASS $1"; }
fail() { echo "FAIL: $1"; exit 1; }

A=00000000-0000-0000-0000-000000000601
B=00000000-0000-0000-0000-000000000602
run >/dev/null <<SQL
insert into auth.users (id, email) values ('$A','a6@x.test'), ('$B','b6@x.test');
select public.participant_id_allocate('$A', 'E');   -- W27/E/0001
SQL
fingerprint() {
  run -c "select md5(coalesce((select string_agg(id || ':' || coalesce(participant_id,'-'), ',' order by id) from public.profiles),'')
                  || coalesce((select json_agg(x order by namespace, number)::text from public.participant_id_allocations x),'')
                  || (select count(*) from public.participant_id_history)
                  || coalesce((select json_agg(x order by namespace)::text from (select namespace, next_number from public.participant_id_namespaces) x),''))"
}

expect_abort() { # $1 label, $2 setup sql, $3 expected error, $4 cleanup sql
  run >/dev/null -c "alter table public.profiles disable trigger trg_guard_profile_participant_id" -c "$2" \
                 -c "alter table public.profiles enable trigger trg_guard_profile_participant_id"
  local before after out
  before=$(fingerprint)
  if out=$($PSQL_CMD -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$MIG" 2>&1); then
    fail "$1: migration did not abort"
  fi
  grep -q "$3" <<<"$out" || fail "$1: wrong error: $(grep ERROR <<<"$out" | head -1)"
  after=$(fingerprint)
  [ "$before" = "$after" ] || fail "$1: data changed despite abort"
  pass "$1: aborts with $3, nothing changed"
  run >/dev/null -c "alter table public.profiles disable trigger trg_guard_profile_participant_id" -c "$4" \
                 -c "alter table public.profiles enable trigger trg_guard_profile_participant_id"
}

expect_abort "malformed legacy id" \
  "update public.profiles set participant_id = 'WD27/0002' where id = '$B'" \
  "MALFORMED_PARTICIPANT_IDS" \
  "update public.profiles set participant_id = null where id = '$B'"
expect_abort "zero number" \
  "update public.profiles set participant_id = 'W27/E/0000' where id = '$B'" \
  "MALFORMED_PARTICIPANT_IDS" \
  "update public.profiles set participant_id = null where id = '$B'"
expect_abort "profile column disagrees with allocation" \
  "update public.profiles set participant_id = 'W27/E/0005' where id = '$A'" \
  "INCONSISTENT_BACKFILL" \
  "update public.profiles set participant_id = 'W27/E/0001' where id = '$A'"
expect_abort "id held by another owner" \
  "update public.profiles set participant_id = null where id = '$A'; update public.profiles set participant_id = 'W27/E/0001' where id = '$B'" \
  "INCONSISTENT_BACKFILL" \
  "update public.profiles set participant_id = null where id = '$B'; update public.profiles set participant_id = 'W27/E/0001' where id = '$A'"
expect_abort "id in the released pool" \
  "insert into public.participant_id_released (namespace, number) values ('E', 7); update public.profiles set participant_id = 'W27/E/0007' where id = '$B'" \
  "INCONSISTENT_BACKFILL" \
  "update public.profiles set participant_id = null where id = '$B'; delete from public.participant_id_released"

# after the cleanups the migration applies cleanly again
$PSQL_CMD -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$MIG" >/dev/null 2>&1 && pass "clean state re-applies" || fail "clean re-apply failed"
