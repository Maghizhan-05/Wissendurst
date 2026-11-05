#!/usr/bin/env bash
# Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
# 0027: migration conversion + concurrency.
#   M1. the customised live filter configuration (slug references) converts to
#       UUIDs with every group id/label/slug/visibility/position unchanged;
#   M2. an unresolvable reference aborts the whole migration (nothing changes);
#   A.  event insert while its category is being archived -> CATEGORY_ARCHIVED;
#   B.  delete while an event insert with that category is in flight -> CATEGORY_IN_USE;
#   C.  event insert while its category is being deleted -> CATEGORY_NOT_FOUND;
#   D.  no event ever references a missing category.
set -euo pipefail
: "${PSQL_CMD:?PSQL_CMD must be set by scripts/test-db.sh}"
run() { $PSQL_CMD -t -A -v ON_ERROR_STOP=1 "$@"; }
pass() { echo "PASS $1"; }
fail() { echo "FAIL: $1"; exit 1; }
MIG="$(cd "$(dirname "$0")/.." && pwd)/migrations/0027_event_categories.sql"
MIG28="$(cd "$(dirname "$0")/.." && pwd)/migrations/0028_category_link_guards.sql"
ADMIN=00000000-0000-0000-0000-000000001601

run >/dev/null -c "grant all on all tables in schema public to anon, authenticated, service_role" \
               -c "grant execute on all functions in schema public to anon, authenticated"
run >/dev/null 2>&1 -f "$MIG"

LIVE='{"allLabel":"All","groups":[
 {"id":"workshop","slug":"quizzes","label":"Quizzes","enabled":true,"position":1,"categories":["workshop"]},
 {"id":"debate","slug":"presentation","label":"Presentation","enabled":true,"position":2,"categories":["debate"]},
 {"id":"poster","slug":"workshop","label":"Workshops","enabled":true,"position":3,"categories":["poster"]},
 {"id":"paper","slug":"englishliteraryevents","label":"English Literary Events","enabled":true,"position":4,"categories":["paper"]},
 {"id":"competition","slug":"tamilliteraryevents","label":"Tamil Literary Events","enabled":false,"position":5,"categories":["competition","academic"]},
 {"id":"academic","slug":"otherevents","label":"Other Events","enabled":true,"position":6,"categories":["academic"]},
 {"id":"other","slug":"other","label":"Other","enabled":true,"position":7,"categories":["other"]}]}'
put_legacy() { # store a pre-0027 (slug) config, bypassing the 0027 trigger
  run >/dev/null -v cfg="$1" <<'SQL'
alter table public.event_filter_config disable trigger event_filter_config_enforce;
update public.event_filter_config set config = :'cfg'::jsonb, updated_by = null, updated_at = '2026-11-05 10:00+00' where id = 1;
alter table public.event_filter_config enable trigger event_filter_config_enforce;
SQL
}

# M1
put_legacy "$LIVE"
run >/dev/null 2>&1 --single-transaction -f "$MIG" || fail "M1: migration failed on the live configuration"
run >/dev/null 2>&1 --single-transaction -f "$MIG28" || fail "M1: 0028 rejected the converted live configuration"
res=$(run -v cfg="$LIVE" <<'SQL'
with old as (select :'cfg'::jsonb c), new as (select config c, updated_at from public.event_filter_config)
select (select jsonb_agg(g - 'categories' order by o) from new, jsonb_array_elements(new.c->'groups') with ordinality t(g, o))
     = (select jsonb_agg(g - 'categories' order by o) from old, jsonb_array_elements(old.c->'groups') with ordinality t(g, o))
   and (select c->'allLabel' from new) = (select c->'allLabel' from old)
   and (select jsonb_agg((select jsonb_agg(to_jsonb(ec.slug) order by x.o) from jsonb_array_elements_text(g->'categories') with ordinality x(s, o)
                          join public.event_categories ec on ec.id = x.s::uuid) order by t.o)
        from new, jsonb_array_elements(new.c->'groups') with ordinality t(g, o))
     = (select jsonb_agg(g->'categories' order by o) from old, jsonb_array_elements(old.c->'groups') with ordinality t(g, o))
   and (select updated_at = '2026-11-05 10:00+00' from new)
   and public.event_filter_config_error((select c from new), (select c from new)) is null;
SQL
)
[ "$res" = "t" ] && pass "M1: customised configuration converted to UUIDs, everything else identical" || fail "M1: $res"

# M2
BAD='{"allLabel":"All","groups":[{"id":"a","slug":"a","label":"A","enabled":true,"position":1,"categories":["workshop","cooking"]}]}'
put_legacy "$BAD"
before=$(run -c "select md5(config::text) || md5((select string_agg(slug, ',') from public.event_categories)) from public.event_filter_config")
if out=$(run --single-transaction -f "$MIG" 2>&1); then fail "M2: migration should have aborted"; fi
grep -q UNRESOLVED_FILTER_CATEGORY <<<"$out" || fail "M2: wrong error: $out"
after=$(run -c "select md5(config::text) || md5((select string_agg(slug, ',') from public.event_categories)) from public.event_filter_config")
[ "$before" = "$after" ] && pass "M2: unresolvable reference aborts and rolls back" || fail "M2: state changed"
put_legacy '{"allLabel":"All","groups":[]}'
run >/dev/null 2>&1 -f "$MIG28"

run >/dev/null <<SQL
insert into auth.users (id, email) values ('$ADMIN', 'c@x.test');
update public.profiles set approval_status = 'approved', role = 'admin', admin_scopes = array['events'] where id = '$ADMIN';
insert into public.event_categories (slug, label, position, icon_key, color_key) values
  ('ca', 'CA', 101, 'mic', 'lime'), ('cb', 'CB', 102, 'mic', 'lime'), ('cc', 'CC', 103, 'mic', 'lime');
SQL
in_tx() { # $1 sql, $2 sleep before commit
  run 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$ADMIN', true);
$1;
select pg_sleep($2);
commit;
SQL
}
cid() { run -c "select id from public.event_categories where slug = '$1'"; }

# A
( in_tx "select public.admin_set_event_category_archived('$(cid ca)', true)" 1.5 >/dev/null ) & p1=$!
sleep 0.4
out=$(in_tx "insert into public.events (slug, title, category) values ('ev-a', 'A', 'ca')" 0 || true)
wait $p1 || fail "A: archive errored"
grep -q CATEGORY_ARCHIVED <<<"$out" && pass "A: assignment during archive refused (CATEGORY_ARCHIVED)" || fail "A: $out"

# B
( in_tx "insert into public.events (slug, title, category) values ('ev-b', 'B', 'cb')" 1.5 >/dev/null ) & p1=$!
sleep 0.4
out=$(in_tx "select public.admin_delete_event_category('$(cid cb)')" 0 || true)
wait $p1 || fail "B: insert errored"
grep -q CATEGORY_IN_USE <<<"$out" && pass "B: delete waits for the in-flight assignment, then refuses (CATEGORY_IN_USE)" || fail "B: $out"

# C
( in_tx "select public.admin_delete_event_category('$(cid cc)')" 1.5 >/dev/null ) & p1=$!
sleep 0.4
out=$(in_tx "insert into public.events (slug, title, category) values ('ev-c', 'C', 'cc')" 0 || true)
wait $p1 || fail "C: delete errored"
grep -q CATEGORY_NOT_FOUND <<<"$out" && pass "C: assignment during delete refused (CATEGORY_NOT_FOUND)" || fail "C: $out"

# D
res=$(run -c "select count(*) from public.events e where not exists (select 1 from public.event_categories c where c.slug = e.category)")
[ "$res" = "0" ] && pass "D: no event references a missing category" || fail "D: $res orphans"
