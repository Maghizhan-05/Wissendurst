#!/usr/bin/env bash
# Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
# 0035 concurrency (approval-free sign-up):
#   A. eight sign-ups completing at the same moment get eight distinct,
#      consecutive W27/E ids (the released number first, exactly once);
#   B. the same sign-up completed three times concurrently allocates once;
#   C. two super admins banning the same account concurrently: exactly one
#      ban row and one audit event; the loser gets ALREADY_BANNED.
set -euo pipefail
: "${PSQL_CMD:?PSQL_CMD must be set by scripts/test-db.sh}"
run() { $PSQL_CMD -t -A -v ON_ERROR_STOP=1 "$@"; }
pass() { echo "PASS $1"; }
fail() { echo "FAIL: $1"; exit 1; }
u() { printf '00000000-0000-0000-0000-0000000036%02d' "$1"; }

run >/dev/null <<SQL
grant usage on schema storage to service_role;
grant all on all tables in schema public to service_role;
grant all on storage.objects to service_role;
insert into auth.users (id, email, raw_user_meta_data)
select ('00000000-0000-0000-0000-0000000036' || lpad(n::text, 2, '0'))::uuid, 'c'||n||'@x.test',
  jsonb_build_object('full_name','Student '||n,'phone','+91 90000 000'||lpad(n::text,2,'0'),'college','Madras Medical College','course','MBBS','year','1')
from generate_series(0, 12) n;
-- two super admins, and one previously used number back in the pool
update public.profiles set approval_status = 'approved', role = 'admin', is_super_admin = true
  where id in ('$(u 0)', '$(u 1)');
select public.participant_id_sync_role(id) from public.profiles where id in ('$(u 0)', '$(u 1)');
select public.participant_id_allocate('$(u 12)', 'E');
select public.participant_id_release('$(u 12)', 'E');
insert into storage.objects (bucket_id, name, owner)
select 'id-cards', p.id::text || '/card.png', p.id from public.profiles p where p.role = 'user';
SQL
released=$(run -c "select number from public.participant_id_released where namespace = 'E'")
next=$(run -c "select next_number from public.participant_id_namespaces where namespace = 'E'")

complete() { # $1 user — the server's sign-up completion, lingering briefly
  run >/dev/null 2>&1 <<SQL
begin;
set local role service_role;
select public.server_complete_signup('$1', '$1/card.png');
select pg_sleep(0.3);
commit;
SQL
}

pids=()
for n in 2 3 4 5 6 7 8 9; do complete "$(u $n)" & pids+=($!); done
for _ in 1 2 3; do complete "$(u 10)" & pids+=($!); done
fails=0
for p in "${pids[@]}"; do wait "$p" || fails=$((fails + 1)); done
[ "$fails" -eq 0 ] && pass "A: 11 concurrent sign-up completions all committed" || fail "$fails completions errored"

nums=$(run -c "select string_agg(a.number::text, ',' order by a.number) from public.participant_id_allocations a where a.namespace = 'E' and a.profile_id in (select id from public.profiles where id::text like '%0036__' and role = 'user' and id <> '$(u 12)')")
expect=$(run -c "select string_agg(n::text, ',' order by n) from (select $released n union all select generate_series($next, $next + 7)) x")
[ "$nums" = "$expect" ] && pass "A: 9 profiles got 9 distinct ids — released $released reused once, then $next.. consecutively" || fail "ids $nums (expected $expect)"

same=$(run -c "select (select count(*) from public.participant_id_history where profile_id = '$(u 10)') || ' ' || (select count(*) from public.profile_approval_events where profile_id = '$(u 10)')")
[ "$same" = "1 1" ] && pass "B: the same sign-up completed 3x concurrently -> one id, one activation event" || fail "same-user rows: $same"

ban() { # $1 super admin
  run 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$1', true);
select public.super_set_user_ban('$(u 3)', true, 'Concurrent ban');
select pg_sleep(0.5);
commit;
SQL
}
( ban "$(u 0)" > ${TMPDIR:-/tmp}/wd35_ban_a.$$ 2>&1 || true ) & p1=$!
sleep 0.2
( ban "$(u 1)" > ${TMPDIR:-/tmp}/wd35_ban_b.$$ 2>&1 || true ) & p2=$!
wait $p1 $p2
loser=$(cat ${TMPDIR:-/tmp}/wd35_ban_a.$$ ${TMPDIR:-/tmp}/wd35_ban_b.$$ | grep -c "ALREADY_BANNED" || true)
rm -f ${TMPDIR:-/tmp}/wd35_ban_a.$$ ${TMPDIR:-/tmp}/wd35_ban_b.$$
state=$(run -c "select (select count(*) from public.profile_bans where profile_id = '$(u 3)') || ' ' || (select count(*) from public.profile_ban_events where profile_id = '$(u 3)')")
[ "$state" = "1 1" ] && [ "$loser" = "1" ] && pass "C: concurrent bans -> one ban row, one audit event, loser told ALREADY_BANNED" || fail "ban state $state, losers $loser"
