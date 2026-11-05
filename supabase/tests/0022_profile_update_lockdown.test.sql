-- Database behaviour test — run with `npm run test:db` (scripts/test-db.sh).
-- 0022_profile_update_lockdown: participants cannot self-approve or touch any
-- protected profile column through the Data API; the narrow RPCs work; the
-- service role and admin RPCs are unaffected.
\set ON_ERROR_STOP 1

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

-- Supabase grants every table/function to anon/authenticated by default; the
-- migration's revokes must win, so grant first and re-run 0022.
grant all on all tables in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated;
drop function if exists public.set_my_profile_photo(text);  -- 0026 changed its signature
\ir ../migrations/0022_profile_update_lockdown.sql
\ir ../migrations/0026_review_hardening.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000701', 'p@x.test'),
  ('00000000-0000-0000-0000-000000000702', 'other@x.test'),
  ('00000000-0000-0000-0000-000000000703', 'adm@x.test');
update public.profiles set role = 'admin', admin_scopes = array['signups'], approval_status = 'approved'
  where id = '00000000-0000-0000-0000-000000000703';
create temp table before_attack as select * from public.profiles where id = '00000000-0000-0000-0000-000000000701';
grant select on before_attack to authenticated;

select pg_temp.check(not has_table_privilege('authenticated', 'public.profiles', 'update')
                 and not has_table_privilege('authenticated', 'public.profiles', 'insert')
                 and not has_table_privilege('authenticated', 'public.profiles', 'delete')
                 and not has_table_privilege('anon', 'public.profiles', 'update'), '1: no direct write privileges for client roles');
select pg_temp.check(not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'profiles_update_own'),
  '1: profiles_update_own removed');

-- ── 2. direct Data API attacks as the participant ──────────────────────────
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000701', false);
select pg_temp.expect_error($q$update public.profiles set approval_status = 'approved' where id = auth.uid()$q$, 'permission denied');
select pg_temp.expect_error($q$update public.profiles set participant_id = 'W27/E/0001' where id = auth.uid()$q$, 'permission denied');
select pg_temp.expect_error($q$update public.profiles set role = 'admin' where id = auth.uid()$q$, 'permission denied');
select pg_temp.expect_error($q$update public.profiles set approved_by = auth.uid() where id = auth.uid()$q$, 'permission denied');
select pg_temp.expect_error($q$update public.profiles set approved_at = now() where id = auth.uid()$q$, 'permission denied');
select pg_temp.expect_error($q$update public.profiles set is_super_admin = true where id = auth.uid()$q$, 'permission denied');
select pg_temp.expect_error($q$update public.profiles set admin_scopes = array['payments'] where id = auth.uid()$q$, 'permission denied');
select pg_temp.expect_error($q$update public.profiles set id_card_path = 'x/y.png' where id = auth.uid()$q$, 'permission denied');
select pg_temp.expect_error($q$update public.profiles set created_at = now() - interval '1 year' where id = auth.uid()$q$, 'permission denied');
select pg_temp.expect_error($q$update public.profiles set updated_at = now() where id = auth.uid()$q$, 'permission denied');
select pg_temp.expect_error($q$update public.profiles set email = 'evil@x.test' where id = auth.uid()$q$, 'permission denied');
select pg_temp.expect_error($q$update public.profiles set full_name = 'Direct write' where id = auth.uid()$q$, 'permission denied');
select pg_temp.expect_error($q$delete from public.profiles where id = auth.uid()$q$, 'permission denied');
select pg_temp.expect_error($q$insert into public.profiles (id, email) values (gen_random_uuid(), 'n@x.test')$q$, 'permission denied');
-- the participant cannot approve themselves through the admin RPC either
select pg_temp.expect_error($q$select public.admin_set_approval(auth.uid(), 'approved')$q$, 'FORBIDDEN');
reset role;
select pg_temp.check((select row(p.*)::text = row(b.*)::text from public.profiles p, before_attack b where p.id = b.id),
  '2: profile row byte-for-byte unchanged after every attack');
select pg_temp.check((select approval_status = 'pending' from public.profiles where id = '00000000-0000-0000-0000-000000000701'),
  '2: self-approval impossible (still pending)');

-- ── 3. legitimate edits through the RPCs ───────────────────────────────────
insert into storage.objects (bucket_id, name, owner)
values ('profile-images', '00000000-0000-0000-0000-000000000701/avatar-1.png', '00000000-0000-0000-0000-000000000701'),
       ('profile-images', '00000000-0000-0000-0000-000000000702/b.png', '00000000-0000-0000-0000-000000000702');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000701', false);
select public.update_my_profile('  Asha Rao ', '+91 98765 43210', 'Govt Medical College', 'MBBS', '3rd year');
select public.set_my_profile_photo('00000000-0000-0000-0000-000000000701/avatar-1.png');
reset role;
select pg_temp.check((select full_name = 'Asha Rao' and phone = '+91 98765 43210' and college = 'Govt Medical College'
                        and course = 'MBBS' and year = '3rd year'
                        and profile_photo = '00000000-0000-0000-0000-000000000701/avatar-1.png'
                      from public.profiles where id = '00000000-0000-0000-0000-000000000701'), '3: valid profile + photo edits saved');
select pg_temp.check((select p.approval_status = b.approval_status and p.role = b.role and p.admin_scopes = b.admin_scopes
                        and p.is_super_admin = b.is_super_admin and p.participant_id is not distinct from b.participant_id
                        and p.id_card_path is not distinct from b.id_card_path and p.email = b.email
                        and p.created_at = b.created_at and p.approved_by is not distinct from b.approved_by
                      from public.profiles p, before_attack b where p.id = b.id), '3: RPC edits leave every protected column untouched');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000701', false);
select pg_temp.expect_error($q$select public.update_my_profile('A', '+91 98765 43210', 'Govt Medical College', 'MBBS', '3')$q$, 'INVALID_PROFILE');
select pg_temp.expect_error($q$select public.update_my_profile('Asha', 'call me', 'Govt Medical College', 'MBBS', '3')$q$, 'INVALID_PROFILE');
select pg_temp.expect_error($q$select public.update_my_profile('Asha', '9876543210', '', 'MBBS', '3')$q$, 'INVALID_PROFILE');
select pg_temp.expect_error($q$select public.update_my_profile(repeat('a', 81), '9876543210', 'GMC', 'MBBS', '3')$q$, 'INVALID_PROFILE');
-- photo = storage object path in the caller's own profile-images folder (0026)
select pg_temp.expect_error($q$select public.set_my_profile_photo('https://evil.example/storage/v1/object/public/profile-images/00000000-0000-0000-0000-000000000701/a.png')$q$, 'INVALID_PHOTO_PATH');
select pg_temp.expect_error($q$select public.set_my_profile_photo('https://abc.supabase.co/storage/v1/object/public/profile-images/00000000-0000-0000-0000-000000000701/avatar-1.png')$q$, 'INVALID_PHOTO_PATH');
select pg_temp.expect_error($q$select public.set_my_profile_photo('00000000-0000-0000-0000-000000000702/b.png')$q$, 'INVALID_PHOTO_PATH');
select pg_temp.expect_error($q$select public.set_my_profile_photo('00000000-0000-0000-0000-000000000701/../702/b.png')$q$, 'INVALID_PHOTO_PATH');
select pg_temp.expect_error($q$select public.set_my_profile_photo('00000000-0000-0000-0000-000000000701/sub/b.png')$q$, 'INVALID_PHOTO_PATH');
select pg_temp.expect_error($q$select public.set_my_profile_photo('javascript:alert(1)')$q$, 'INVALID_PHOTO_PATH');
select pg_temp.expect_error($q$select public.set_my_profile_photo('00000000-0000-0000-0000-000000000701/never-uploaded.png')$q$, 'PHOTO_NOT_UPLOADED');
select public.set_my_profile_photo(null);
reset role;
select pg_temp.check((select profile_photo is null from public.profiles where id = '00000000-0000-0000-0000-000000000701'), '3: photo can be removed');

set role anon;
select pg_temp.expect_error($q$select public.update_my_profile('Asha', '9876543210', 'GMC', 'MBBS', '3')$q$, 'permission denied');
select pg_temp.expect_error($q$select public.set_my_profile_photo(null)$q$, 'permission denied');
reset role;

-- ── 4. backstop: even a re-granted privilege + permissive policy is refused ─
grant update on public.profiles to authenticated;
create policy tmp_permissive on public.profiles for update using (true) with check (true);
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000701', false);
select pg_temp.expect_error($q$update public.profiles set approval_status = 'approved' where id = auth.uid()$q$, 'PROFILE_DIRECT_WRITE_FORBIDDEN');
reset role;
drop policy tmp_permissive on public.profiles;
revoke update on public.profiles from authenticated;

-- ── 5. service role + admin RPCs still work ────────────────────────────────
set role service_role;
update public.profiles set id_card_path = '00000000-0000-0000-0000-000000000701/id.png'
  where id = '00000000-0000-0000-0000-000000000701';
reset role;
select pg_temp.check((select id_card_path = '00000000-0000-0000-0000-000000000701/id.png' from public.profiles
                      where id = '00000000-0000-0000-0000-000000000701'), '5: service role can record the signup ID card');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000703', false);
select public.admin_set_approval('00000000-0000-0000-0000-000000000701', 'approved');
reset role;
select pg_temp.check((select approval_status = 'approved' and participant_id like 'W27/E/%' from public.profiles
                      where id = '00000000-0000-0000-0000-000000000701'), '5: signups admin approval still works (and allocates an E id)');
select 'ALL 0022 TESTS PASSED';
