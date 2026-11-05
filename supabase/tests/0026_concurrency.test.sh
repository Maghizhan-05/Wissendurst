#!/usr/bin/env bash
# Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
# 0026 concurrency (event hierarchy lock):
#   A. archive then restore of the same event, overlapping -> the restore waits
#      and re-reads, so the final state is the LATER request (active);
#   B. a child created while its parent is being archived -> refused
#      (PARENT_ARCHIVED), never left active under an archived parent;
#   C. a child created just before an archive commits -> archived with it.
set -euo pipefail
: "${PSQL_CMD:?PSQL_CMD must be set by scripts/test-db.sh}"
run() { $PSQL_CMD -t -A -v ON_ERROR_STOP=1 "$@"; }
pass() { echo "PASS $1"; }
fail() { echo "FAIL: $1"; exit 1; }
ADMIN=00000000-0000-0000-0000-000000001401

run >/dev/null -c "grant all on all tables in schema public to anon, authenticated, service_role" \
               -c "grant execute on all functions in schema public to anon, authenticated"
run >/dev/null 2>&1 -f "$(cd "$(dirname "$0")/.." && pwd)/migrations/0026_review_hardening.sql"
run >/dev/null <<SQL
insert into auth.users (id, email) values ('$ADMIN', 'h@x.test');
update public.profiles set approval_status = 'approved', role = 'admin', admin_scopes = array['events'] where id = '$ADMIN';
insert into public.events (slug, title, registration_open, is_live) values ('a', 'A', true, true), ('b', 'B', true, true), ('c', 'C', true, true);
SQL

in_tx() { # $1 sql, $2 sleep (seconds) before commit
  run 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$ADMIN', true);
$1;
select pg_sleep($2);
commit;
SQL
}
id_of() { run -c "select id from public.events where slug = '$1'"; }

# A. archive (held open) then restore
A=$(id_of a)
( in_tx "select public.admin_set_event_archived('$A', true)" 1.5 >/dev/null ) & p1=$!
sleep 0.4
( in_tx "select public.admin_set_event_archived('$A', false)" 0 >/dev/null ) & p2=$!
wait $p1 || fail "A: archive errored"; wait $p2 || fail "A: restore errored"
res=$(run -c "select coalesce(archived_at::text, 'active') from public.events where slug = 'a'")
[ "$res" = "active" ] && pass "A: later restore wins (no lost update)" || fail "A: final state $res"

# B. child insert while parent archive is in flight
B=$(id_of b)
( in_tx "select public.admin_set_event_archived('$B', true)" 1.5 >/dev/null ) & p1=$!
sleep 0.4
out=$(in_tx "insert into public.events (slug, title, parent_event_id) values ('b-kid', 'B kid', '$B')" 0 || true)
wait $p1 || fail "B: archive errored"
grep -q PARENT_ARCHIVED <<<"$out" && pass "B: concurrent child insert refused with PARENT_ARCHIVED" || fail "B: insert output: $out"
res=$(run -c "select count(*) from public.events e join public.events p on p.id = e.parent_event_id where p.archived_at is not null and e.archived_at is null")
[ "$res" = "0" ] && pass "B: no active child under an archived parent" || fail "B: $res orphans"

# C. child insert held open, archive starts afterwards
C=$(id_of c)
( in_tx "insert into public.events (slug, title, parent_event_id) values ('c-kid', 'C kid', '$C')" 1.5 >/dev/null ) & p1=$!
sleep 0.4
( in_tx "select public.admin_set_event_archived('$C', true)" 0 >/dev/null ) & p2=$!
wait $p1 || fail "C: insert errored"; wait $p2 || fail "C: archive errored"
res=$(run -c "select (archived_at is not null)::text from public.events where slug = 'c-kid'")
[ "$res" = "true" ] && pass "C: child committed first is archived with its parent" || fail "C: c-kid archived=$res"
