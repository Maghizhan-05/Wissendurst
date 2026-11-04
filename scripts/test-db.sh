#!/usr/bin/env bash
# Database behaviour tests for supabase/migrations.
#
# Spins up a throwaway local PostgreSQL cluster, and for every
# supabase/tests/*.test.sql (and *.test.sh, given $PSQL_CMD) file: creates a
# fresh database, loads a minimal
# Supabase shim (auth/storage schemas, anon/authenticated/service_role),
# applies every migration in order, re-applies the latest two migrations to
# prove they are re-runnable, then runs the test file. Never touches a remote
# database.
#
# Requires PostgreSQL server binaries (initdb, pg_ctl, psql) on PATH or in
# $PG_BIN, e.g. PG_BIN=/opt/homebrew/opt/postgresql@16/bin npm run test:db
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
TESTS="$ROOT/supabase/tests"
BIN="${PG_BIN:+$PG_BIN/}"
PORT="${PG_TEST_PORT:-55439}"
export LC_ALL=C LANG=C

WORK="$(mktemp -d "${TMPDIR:-/tmp}/wd-dbtest.XXXXXX")"
cleanup() {
  "${BIN}pg_ctl" -D "$WORK/data" stop -m fast >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"${BIN}initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${BIN}pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" \
  -l "$WORK/log" -w start >/dev/null

PSQL=("${BIN}psql" -h "$WORK" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)
MIGS=()
while IFS= read -r f; do MIGS+=("$f"); done < <(ls "$MIGRATIONS"/*.sql | sort)

setup_db() { # $1 = test name
  "${PSQL[@]}" -d postgres -c "drop database if exists wd_test" \
    -c "create database wd_test" >/dev/null 2>&1
  "${PSQL[@]}" -d wd_test -f "$TESTS/supabase_shim.sql" >/dev/null 2>&1
  for m in "${MIGS[@]}"; do
    "${PSQL[@]}" -d wd_test -f "$m" >/dev/null 2>"$WORK/err" || {
      echo "FAIL [$1] applying $(basename "$m")"; cat "$WORK/err"; exit 1; }
  done
  # Re-apply the newest two migrations (in order) to prove they re-run cleanly.
  for m in "${MIGS[@]: -2}"; do
    "${PSQL[@]}" -d wd_test -f "$m" >/dev/null 2>"$WORK/err" || {
      echo "FAIL [$1] re-applying $(basename "$m")"; cat "$WORK/err"; exit 1; }
  done
}

report() { # $1 = name, $2 = exit status, $3 = output
  if [ "$2" -eq 0 ]; then
    echo "ok   [$1] $(grep -c '^PASS' <<<"$3") assertions passed"
  else
    failed=1
    echo "FAIL [$1] after $(grep -c '^PASS' <<<"$3") assertions"
    grep -E "ERROR|FAIL|WRONG" <<<"$3" | head -5
  fi
}

failed=0
for test in "$TESTS"/*.test.sql "$TESTS"/*.test.sh; do
  [ -e "$test" ] || continue
  name="$(basename "$test")"
  setup_db "$name"
  status=0
  case "$test" in
    *.sql) out="$("${PSQL[@]}" -d wd_test -t -A -f "$test" 2>&1)" || status=$? ;;
    *.sh)  out="$(PSQL_CMD="${PSQL[*]} -d wd_test" bash "$test" 2>&1)" || status=$? ;;
  esac
  report "$name" "$status" "$out"
done
exit $failed
