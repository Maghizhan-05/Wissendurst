#!/usr/bin/env bash
set -euo pipefail
: "${PSQL_CMD:?}"
# Exercise the existing, unchanged claim RPC under real concurrent sessions.
bash "$(dirname "$0")/0037_concurrency.test.sh"
run() { $PSQL_CMD -t -A -v ON_ERROR_STOP=1 "$@"; }
u() { printf '00000000-0000-0000-0000-00000038%04d' "$1"; }
W=$(mktemp -d "${TMPDIR:?}/d38-race.XXXXXX")
trap 'rm -rf "$W"' EXIT
run >/dev/null <<SQL
insert into auth.users(id,email) values('$(u 1)','d38race1@example.test'),('$(u 2)','d38race2@example.test');
update public.profiles set role='admin',is_super_admin=true where id='$(u 1)';
insert into public.events(id,slug,title,registration_fee,registration_open,is_live) values('$(u 100)','race38','Race38',0,true,true);
insert into public.registrations(id,profile_id,event_id,amount,registration_status,payment_status)
values('$(u 301)','$(u 2)','$(u 100)',0,'confirmed','verified');
SQL
# Same read-committed transaction: a new statement must observe committed
# acceptance from another session. STABLE must not mean a cross-call cache.
PGAPPNAME=d38_inventory_reader run >"$W/reader" 2>&1 <<SQL &
begin;
set local role authenticated;
set local request.jwt.claim.sub='$(u 1)';
select exists(select 1 from jsonb_array_elements(public.email_backfill_inventory()->'units') x where x->>'registration_id'='$(u 301)');
select pg_sleep(1.5);
select not exists(select 1 from jsonb_array_elements(public.email_backfill_inventory()->'units') x where x->>'registration_id'='$(u 301)');
commit;
SQL
READER=$!
ready=false
for _ in {1..100}; do
  if [[ $(run -c "select exists(select 1 from pg_stat_activity where application_name='d38_inventory_reader' and wait_event='PgSleep')") == t ]]; then ready=true; break; fi
  sleep 0.02
done
[[ $ready == true ]] || { printf 'FAIL inventory reader not ready\n'; exit 1; }
run >/dev/null <<SQL
begin;
set local role service_role;
insert into public.email_delivery_log(kind,outcome,registration_id,source) values('registration_confirmed','sent','$(u 301)','automatic');
commit;
SQL
wait "$READER"
python - "$W/reader" <<'PY'
from pathlib import Path
import sys
rows=[s.strip() for s in Path(sys.argv[1]).read_text().splitlines() if s.strip()]
assert rows==['t','t'], f'FAIL committed acceptance visibility: {rows}'
print('PASS inventory initially includes unsent registration')
print('PASS next inventory statement in same transaction observes another session committed acceptance')
PY
