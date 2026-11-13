#!/usr/bin/env bash
# Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
# 0032 concurrency: two teams formed at the same moment (different events, so
# no shared event lock) get different, consecutive team codes; a rolled-back
# team leaves no gap.
set -euo pipefail
: "${PSQL_CMD:?PSQL_CMD must be set by scripts/test-db.sh}"
run() { $PSQL_CMD -t -A -v ON_ERROR_STOP=1 "$@"; }
pass() { echo "PASS $1"; }
fail() { echo "FAIL: $1"; exit 1; }
u() { printf '00000000-0000-0000-0000-0000000034%02d' "$1"; }

run >/dev/null -c "grant all on all tables in schema public to anon, authenticated, service_role"
run >/dev/null <<SQL
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000034' || lpad(n::text, 2, '0'))::uuid, 'q'||n||'@x.test' from generate_series(0, 9) n;
update public.profiles set approval_status = 'approved';
insert into public.events (slug, title, registration_fee, team_fee, registration_open, is_live, team_enabled, team_max)
values ('qa', 'A', 0, 0, true, true, true, 3), ('qb', 'B', 0, 0, true, true, true, 3), ('qc', 'C', 0, 0, true, true, true, 3);
SQL
as_tx() { # $1 user, $2 sql, $3 sleep before commit, $4 commit|rollback
  run 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$1', true);
$2;
select pg_sleep($3);
${4:-commit};
SQL
}
ev() { run -c "select id from public.events where slug = '$1'"; }
code() { run -c "select coalesce(t.code, '-') from public.teams t join public.registrations r on r.team_id = t.id where r.profile_id = '$1' and r.event_id = '$(ev "$2")'"; }

( as_tx "$(u 1)" "select public.register_team('$(ev qa)', array['$(u 2)']::uuid[], 'A')" 1.0 >/dev/null 2>&1 || true ) & p1=$!
sleep 0.2
as_tx "$(u 3)" "select public.register_team('$(ev qb)', array['$(u 4)']::uuid[], 'B')" 0 >/dev/null
wait $p1
A=$(code "$(u 1)" qa); B=$(code "$(u 3)" qb)
[ "$A" != "$B" ] && [ "$A" != "-" ] && [ "$B" != "-" ] && printf '%s\n%s\n' "$A" "$B" | sort | tr '\n' ' ' | grep -q "W27/T/0001 W27/T/0002" \
  && pass "concurrent teams got distinct consecutive codes ($A, $B)" || fail "codes A=$A B=$B"

as_tx "$(u 5)" "select public.register_team('$(ev qc)', array['$(u 6)']::uuid[], 'C')" 0 rollback >/dev/null
as_tx "$(u 7)" "select public.register_team('$(ev qc)', array['$(u 8)']::uuid[], 'D')" 0 >/dev/null
[ "$(code "$(u 7)" qc)" = "W27/T/0003" ] && pass "a rolled-back team leaves no gap" || fail "after rollback: $(code "$(u 7)" qc)"
