#!/usr/bin/env bash
# Real concurrent sessions: claims, replay, cancellation and rollback.
set -euo pipefail
: "${PSQL_CMD:?}"
run() { $PSQL_CMD -t -A -v ON_ERROR_STOP=1 "$@"; }
u() { printf '00000000-0000-0000-0000-0000000037%02d' "$1"; }
W=$(mktemp -d "${TMPDIR:?}/d37-race.XXXXXX")
trap 'rm -rf "$W"' EXIT
run >/dev/null <<SQL
insert into auth.users(id,email) select ('00000000-0000-0000-0000-0000000037'||lpad(n::text,2,'0'))::uuid,'race'||n||'@example.test' from generate_series(1,8) n;
update public.profiles set approval_status='approved';
update public.profiles set role='admin',is_super_admin=true where id in ('$(u 1)','$(u 2)');
insert into public.events(id,slug,title,registration_fee,registration_open,is_live) values('$(u 10)','race37','Race37',0,true,true);
insert into public.registrations(id,profile_id,event_id,amount,registration_status,payment_status)
select ('00000000-0000-0000-0000-0000000037'||lpad((n+10)::text,2,'0'))::uuid,
('00000000-0000-0000-0000-0000000037'||lpad(n::text,2,'0'))::uuid,'$(u 10)',0,'confirmed','verified' from generate_series(3,8) n;
SQL
claim() { run -c "set role authenticated; set request.jwt.claim.sub='$(u "$1")'; select public.claim_registration_email_resend('$(u "$2")','$(u "$3")');"; }
start_hold() {
  PGAPPNAME=d37_hold run >"$W/holder" 2>&1 <<SQL &
begin;
$1;
select pg_sleep(1.5);
$2;
SQL
  HOLDER=$!
  ready=false
  for _ in {1..100}; do
    if [[ $(run -c "select exists(select 1 from pg_stat_activity where application_name='d37_hold' and wait_event='PgSleep')") == t ]]; then ready=true; break; fi
    sleep 0.02
  done
  [[ $ready == true ]] || { printf 'FAIL holder not ready\n'; exit 1; }
}
assert_eq() { [[ $1 == "$2" ]] || { printf 'FAIL %s: got <%s> expected <%s>\n' "$3" "$1" "$2"; exit 1; }; printf 'PASS %s\n' "$3"; }
start_hold "set local role authenticated; set local request.jwt.claim.sub='$(u 1)'; select public.claim_registration_email_resend('$(u 13)','$(u 30)')" commit
out=$(claim 2 13 31); wait "$HOLDER"
assert_eq "$out" f 'different requests serialize; second actor hits shared cooldown'
assert_eq "$(run -c "select count(*) from public.registration_email_resend_claims where registration_id='$(u 13)'")" 1 'one persisted claim under concurrent request IDs'
start_hold "set local role authenticated; set local request.jwt.claim.sub='$(u 1)'; select public.claim_registration_email_resend('$(u 14)','$(u 32)')" commit
out=$(claim 1 14 32); wait "$HOLDER"
assert_eq "$out" f 'same concurrent request returns false after winner commits'
start_hold "set local role authenticated; set local request.jwt.claim.sub='$(u 1)'; select public.claim_registration_email_resend('$(u 15)','$(u 33)')" commit
out=$(claim 2 16 33 2>&1 || true); wait "$HOLDER"
[[ $out == *REQUEST_ID_REUSED* ]] || { printf 'FAIL cross-registration replay: %s\n' "$out"; exit 1; }
printf 'PASS cross-registration concurrent request reuse refused\n'
start_hold "update public.registrations set registration_status='cancelled' where id='$(u 17)'" commit
out=$(claim 1 17 34 2>&1 || true); wait "$HOLDER"
[[ $out == *REGISTRATION_NOT_CONFIRMED* ]] || { printf 'FAIL cancellation race: %s\n' "$out"; exit 1; }
printf 'PASS waiting claim observes committed cancellation\n'
start_hold "set local role authenticated; set local request.jwt.claim.sub='$(u 1)'; select public.claim_registration_email_resend('$(u 18)','$(u 35)')" rollback
out=$(claim 2 18 36); wait "$HOLDER"
assert_eq "$out" t 'rolled-back claim does not consume cooldown'
assert_eq "$(run -c "select count(*) from public.registration_email_resend_claims where registration_id='$(u 18)'")" 1 'rollback leaves only successful claim'
run >/dev/null <<SQL
insert into auth.users(id,email) values('$(u 9)','race9@example.test'),('$(u 10)','race10@example.test');
insert into public.teams(id,event_id,head_profile_id) values('$(u 49)','$(u 10)','$(u 9)');
insert into public.registrations(id,profile_id,event_id,amount,registration_status,payment_status,team_id,is_team_head)
values('$(u 50)','$(u 9)','$(u 10)',0,'confirmed','verified','$(u 49)',true),
('$(u 51)','$(u 10)','$(u 10)',0,'confirmed','verified','$(u 49)',false);
SQL
start_hold "set local role authenticated; set local request.jwt.claim.sub='$(u 1)'; select public.claim_registration_email_resend('$(u 51)','$(u 52)')" commit
out=$(claim 2 50 53); wait "$HOLDER"
assert_eq "$out" f 'concurrent teammate and head requests share one cooldown'
assert_eq "$(run -c "select count(*)=1 and bool_and(registration_id='$(u 51)' and throttle_registration_id='$(u 50)') from public.registration_email_resend_claims where throttle_registration_id='$(u 50)'")" t 'original member request retained; head is canonical throttle target'
