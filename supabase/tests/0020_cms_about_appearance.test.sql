-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0020_cms_about_appearance: appearance allowlist constraint, about column,
-- targeted spelling fix in saved home-page JSON, access rules.
\set ON_ERROR_STOP 1
grant all on all tables in schema public to anon, authenticated;

create or replace function pg_temp.expect_error(p_sql text, p_needle text) returns text
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_ERROR_NOT_RAISED: % (wanted %)', p_sql, p_needle;
exception when others then
  if sqlerrm like 'EXPECTED_ERROR_NOT_RAISED%' or position(p_needle in sqlerrm) = 0 then
    raise exception 'WRONG_ERROR for %: got "%" wanted "%"', p_sql, sqlerrm, p_needle;
  end if;
  return 'PASS error ' || p_needle;
end $$;
create or replace function pg_temp.check(p_ok boolean, p_label text) returns text
language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_label; end if;
  return 'PASS ' || p_label;
end $$;

-- 1. Columns exist with safe defaults
select pg_temp.check((select about = '{}'::jsonb and appearance = '{}'::jsonb from public.site_settings where id = 1),
  '1: about/appearance default to empty objects');

-- 2. Appearance constraint: allowlisted tokens with #rrggbb only
update public.site_settings set appearance = '{"light":{"brand":"#087F78","surface-2":"#ffffff"},"dark":{"ring":"#32d6c1"}}' where id = 1;
select pg_temp.check(true, '2: valid overrides accepted');
select pg_temp.expect_error($q$update public.site_settings set appearance = '{"light":{"brand":"red"}}' where id = 1$q$, 'site_settings_appearance_valid');
select pg_temp.expect_error($q$update public.site_settings set appearance = '{"light":{"brand":"#fff"}}' where id = 1$q$, 'site_settings_appearance_valid');
select pg_temp.expect_error($q$update public.site_settings set appearance = '{"light":{"brand":"#000000;}body{display:none"}}' where id = 1$q$, 'site_settings_appearance_valid');
select pg_temp.expect_error($q$update public.site_settings set appearance = '{"light":{"font-family":"#000000"}}' where id = 1$q$, 'site_settings_appearance_valid');
select pg_temp.expect_error($q$update public.site_settings set appearance = '{"print":{"brand":"#000000"}}' where id = 1$q$, 'site_settings_appearance_valid');
select pg_temp.expect_error($q$update public.site_settings set appearance = '{"light":"#000000"}' where id = 1$q$, 'site_settings_appearance_valid');
select pg_temp.expect_error($q$update public.site_settings set appearance = '{"light":{"brand":7}}' where id = 1$q$, 'site_settings_appearance_valid');
select pg_temp.expect_error($q$update public.site_settings set appearance = '[]' where id = 1$q$, 'site_settings_appearance_valid');
select pg_temp.expect_error($q$update public.site_settings set about = '[]' where id = 1$q$, 'site_settings_about_object');
select pg_temp.check((select appearance->'light'->>'brand' = '#087F78' from public.site_settings where id = 1), '2: rejected writes left the stored value intact');

-- 3. Spelling fix touches only misspelled strings
update public.site_settings set content = $j${
  "hero": {"titleLine1": "Wissendurst", "titleAccent": "'27", "date": "January 28 - 31 , 2027"},
  "intro": {"paragraphs": ["Wissendrust'27 gathers students — “quotes” & ünïcode ✓", "Second paragraph"]},
  "finalCta": {"title": "Ready to be part of Wissendrust'27?"},
  "footer": {"contactEmail": "wissendrust27@example.org", "dates": "Jan"},
  "info": {"items": [{"label": "WISSENDRUST", "value": "x"}]}
}$j$::jsonb where id = 1;
create temp table before_fix as select content from public.site_settings where id = 1;
\ir ../migrations/0020_cms_about_appearance.sql
select pg_temp.check((select content::text !~* 'wissendrust' from public.site_settings where id = 1), '3: no old spelling remains');
select pg_temp.check((select content->'finalCta'->>'title' = 'Ready to be part of Wissendurst''27?'
   and content->'intro'->'paragraphs'->>0 = 'Wissendurst''27 gathers students — “quotes” & ünïcode ✓'
   and content->'footer'->>'contactEmail' = 'wissendurst27@example.org'
   and content->'info'->'items'->0->>'label' = 'WISSENDURST'
   from public.site_settings where id = 1), '3: misspelled values corrected (all cases)');
select pg_temp.check((select s.content #- '{finalCta,title}' #- '{intro,paragraphs,0}' #- '{footer,contactEmail}' #- '{info,items,0,label}'
   = b.content #- '{finalCta,title}' #- '{intro,paragraphs,0}' #- '{footer,contactEmail}' #- '{info,items,0,label}'
   from public.site_settings s, before_fix b where s.id = 1), '3: every other value unchanged');
select pg_temp.check((select appearance->'light'->>'brand' = '#087F78' from public.site_settings where id = 1), '3: re-running 0020 kept appearance');
create temp table after_fix as select content, updated_at from public.site_settings where id = 1;
\ir ../migrations/0020_cms_about_appearance.sql
select pg_temp.check((select s.content = a.content and s.updated_at = a.updated_at from public.site_settings s, after_fix a where s.id = 1),
  '3: fix is idempotent (no rewrite on re-run)');

-- 4. Access: public read, content-scope admin write, others denied
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000500', 'c@x.test'),
  ('00000000-0000-0000-0000-000000000501', 'p@x.test');
update public.profiles set role = 'admin', admin_scopes = array['content'] where id = '00000000-0000-0000-0000-000000000500';
set role anon;
select pg_temp.check((select appearance->'dark'->>'ring' = '#32d6c1' from public.site_settings where id = 1), '4: anonymous visitors can read appearance');
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000501', false);
update public.site_settings set about = '{"title":"hacked"}' where id = 1;
select pg_temp.check((select about = '{}'::jsonb from public.site_settings where id = 1), '4: participants cannot write settings');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000500', false);
update public.site_settings set about = '{"title":"Edited"}' where id = 1;
select pg_temp.check((select about->>'title' = 'Edited' from public.site_settings where id = 1), '4: content admin can write settings');
select pg_temp.expect_error($q$update public.site_settings set appearance = '{"light":{"brand":"red"}}' where id = 1$q$, 'site_settings_appearance_valid');
reset role;
select 'ALL 0020 TESTS PASSED';
