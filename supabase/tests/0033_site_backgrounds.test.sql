-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0033: site background settings validation, image existence, access rules.
\set ON_ERROR_STOP 1
grant all on all tables in schema public to anon, authenticated;
\ir ../migrations/0033_site_backgrounds.sql

create or replace function pg_temp.expect_error(p_sql text, p_needle text) returns text
language plpgsql as $$
declare v_detail text;
begin
  execute p_sql;
  raise exception 'EXPECTED_ERROR_NOT_RAISED: % (wanted %)', p_sql, p_needle;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  if sqlerrm like 'EXPECTED_ERROR_NOT_RAISED%' or position(p_needle in sqlerrm || ' ' || coalesce(v_detail, '')) = 0 then
    raise exception 'WRONG_ERROR for %: got "%" (%) wanted "%"', p_sql, sqlerrm, v_detail, p_needle;
  end if;
  return 'PASS error ' || p_needle;
end $$;
create or replace function pg_temp.check(p_ok boolean, p_label text) returns text
language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_label; end if;
  return 'PASS ' || p_label;
end $$;

insert into public.site_settings (id) values (1) on conflict do nothing;

-- 1. bucket and default
select pg_temp.check((select public and file_size_limit = 5242880
  and allowed_mime_types = array['image/png','image/jpeg','image/webp'] from storage.buckets where id = 'site-images'),
  '1: public site-images bucket, 5 MB, PNG/JPEG/WebP only');
select pg_temp.check((select backgrounds = '{}'::jsonb from public.site_settings where id = 1), '1: no background by default');

-- 2. validation
insert into storage.objects (bucket_id, name) values ('site-images', 'backgrounds/light-1.png'), ('site-images', 'backgrounds/dark-1.webp');
update public.site_settings set backgrounds = '{"light":"backgrounds/light-1.png","dark":"backgrounds/dark-1.webp","opacity":40,"overlay_color":"#102030","overlay_strength":20,"position":"top","size":"cover","repeat":false}' where id = 1;
select pg_temp.check((select backgrounds->>'dark' = 'backgrounds/dark-1.webp' from public.site_settings where id = 1), '2: a valid setting saves');
update public.site_settings set backgrounds = '{"light":null,"dark":null,"opacity":30,"overlay_color":"#000000","overlay_strength":0,"position":"center","size":"cover","repeat":false}' where id = 1;
select pg_temp.check(true, '2: removing both images saves');
select pg_temp.expect_error($q$update public.site_settings set backgrounds = '{"light":"backgrounds/missing.png"}' where id = 1$q$, 'BACKGROUND_IMAGE_NOT_FOUND');
select pg_temp.expect_error($q$update public.site_settings set backgrounds = '{"light":"../id-cards/x.png"}' where id = 1$q$, 'site_settings_backgrounds_valid');
select pg_temp.expect_error($q$update public.site_settings set backgrounds = '{"light":"backgrounds/x.png\");}body{display:none"}' where id = 1$q$, 'site_settings_backgrounds_valid');
select pg_temp.expect_error($q$update public.site_settings set backgrounds = '{"opacity":3}' where id = 1$q$, 'site_settings_backgrounds_valid');
select pg_temp.expect_error($q$update public.site_settings set backgrounds = '{"opacity":50.5}' where id = 1$q$, 'site_settings_backgrounds_valid');
select pg_temp.expect_error($q$update public.site_settings set backgrounds = '{"overlay_strength":95}' where id = 1$q$, 'site_settings_backgrounds_valid');
select pg_temp.expect_error($q$update public.site_settings set backgrounds = '{"overlay_color":"red"}' where id = 1$q$, 'site_settings_backgrounds_valid');
select pg_temp.expect_error($q$update public.site_settings set backgrounds = '{"position":"0 0;color:red"}' where id = 1$q$, 'site_settings_backgrounds_valid');
select pg_temp.expect_error($q$update public.site_settings set backgrounds = '{"size":"100%"}' where id = 1$q$, 'site_settings_backgrounds_valid');
select pg_temp.expect_error($q$update public.site_settings set backgrounds = '{"repeat":"yes"}' where id = 1$q$, 'site_settings_backgrounds_valid');
select pg_temp.expect_error($q$update public.site_settings set backgrounds = '{"css":"x"}' where id = 1$q$, 'site_settings_backgrounds_valid');
select pg_temp.expect_error($q$update public.site_settings set backgrounds = '[]' where id = 1$q$, 'site_settings_backgrounds_valid');
-- an image in another bucket with the same name doesn't count
insert into storage.objects (bucket_id, name) values ('id-cards', 'backgrounds/other.png');
select pg_temp.expect_error($q$update public.site_settings set backgrounds = '{"light":"backgrounds/other.png"}' where id = 1$q$, 'BACKGROUND_IMAGE_NOT_FOUND');
-- other columns still save while the stored background's image is later removed
update public.site_settings set backgrounds = '{"light":"backgrounds/light-1.png"}' where id = 1;
delete from storage.objects where name = 'backgrounds/light-1.png';
update public.site_settings set appearance = '{}' where id = 1;
select pg_temp.check(true, '2: unrelated saves are not blocked by the image check');

-- 3. re-run is safe
\ir ../migrations/0033_site_backgrounds.sql
select pg_temp.check((select backgrounds->>'light' = 'backgrounds/light-1.png' from public.site_settings where id = 1), '3: re-run keeps the setting');
select 'ALL 0033 TESTS PASSED';
