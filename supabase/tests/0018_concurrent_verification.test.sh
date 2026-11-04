#!/usr/bin/env bash
# Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
# 0018 concurrency: two admins verify two different expired intents for the
# last seat at the same time. The per-event advisory lock must serialise them:
# the second call waits for the first to commit, then fails with
# EVENT_FULL_AT_VERIFICATION. Without the lock both would succeed (overbook).
#
# Invoked by the runner with PSQL_CMD set to a psql command line for the
# freshly migrated test database.
set -euo pipefail
: "${PSQL_CMD:?PSQL_CMD must be set by scripts/test-db.sh}"
run() { $PSQL_CMD -t -A -v ON_ERROR_STOP=1 "$@"; }

ADMIN=00000000-0000-0000-0000-000000000300
U1=00000000-0000-0000-0000-000000000301
U2=00000000-0000-0000-0000-000000000302

run >/dev/null <<SQL
grant all on all tables in schema public to anon, authenticated;
insert into auth.users (id, email) values ('$ADMIN','a3@x.test'), ('$U1','b3@x.test'), ('$U2','c3@x.test');
update public.profiles set approval_status = 'approved';
update public.profiles set role = 'admin', admin_scopes = array['payments'] where id = '$ADMIN';
insert into public.events (slug, title, registration_fee, registration_open, is_live, max_participants)
values ('race', 'Race', 1000, true, true, 1);
-- Two intents created one after another (the first expires to free the seat),
-- then both expired: neither holds a seat, one seat is free.
set role authenticated;
select set_config('request.jwt.claim.sub', '$U1', false);
select public.register_for_event((select id from public.events where slug = 'race'));
reset role;
update public.registrations set hold_expires_at = now() - interval '1 minute';
set role authenticated;
select set_config('request.jwt.claim.sub', '$U2', false);
select public.register_for_event((select id from public.events where slug = 'race'));
reset role;
update public.registrations set hold_expires_at = now() - interval '1 minute';
SQL

R1=$(run -c "select id from public.registrations where profile_id = '$U1'")
R2=$(run -c "select id from public.registrations where profile_id = '$U2'")

# Session A verifies R1 and keeps its transaction open for 2 seconds.
( run >/dev/null 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$ADMIN', true);
select public.admin_set_payment_status('$R1', 'verified', null);
select pg_sleep(2);
commit;
SQL
) &
A_PID=$!
sleep 0.5

# Session B verifies R2 while A still holds the lock.
start=$(date +%s)
B_OUT=$(run 2>&1 <<SQL || true
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$ADMIN', true);
select public.admin_set_payment_status('$R2', 'verified', null);
commit;
SQL
)
end=$(date +%s)
wait $A_PID

waited=$((end - start))
confirmed=$(run -c "select count(*) from public.registrations where registration_status = 'confirmed'")
r2_state=$(run -c "select registration_status||'/'||payment_status from public.registrations where id = '$R2'")

fail=0
check() { if [ "$1" = "1" ]; then echo "PASS $2"; else echo "FAIL: $2"; fail=1; fi; }
check "$([ "$waited" -ge 1 ] && echo 1)" "concurrent verification waited for the event lock (${waited}s)"
check "$(grep -q EVENT_FULL_AT_VERIFICATION <<<"$B_OUT" && echo 1)" "second concurrent verification refused with EVENT_FULL_AT_VERIFICATION"
check "$([ "$confirmed" = "1" ] && echo 1)" "exactly one registration confirmed for the single seat (got $confirmed)"
check "$([ "$r2_state" = "pending/unpaid" ] && echo 1)" "refused registration unchanged ($r2_state)"
exit $fail
