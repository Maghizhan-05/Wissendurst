-- ============================================================================
-- WISSENDURST'27 — 0022_profile_update_lockdown
--
-- Security fix: profiles_update_own (0002) only stopped a participant from
-- changing `role`; through the Data API a signed-in participant could set
-- their own approval_status (self-approval), approved_by/approved_at,
-- admin_scopes, is_super_admin, id_card_path and timestamps.
--
--   * Direct INSERT/UPDATE/DELETE on profiles is revoked from anon and
--     authenticated and profiles_update_own is dropped.
--   * Participants edit their own details only through two narrow RPCs:
--       update_my_profile(full_name, phone, college, course, year)
--       set_my_profile_photo(url)   -- own folder of the public profile-images bucket, or null
--   * A backstop trigger rejects any direct profile write made as anon or
--     authenticated, even if table privileges are ever re-granted.
--   * Unchanged: service-role writes (signup ID-card path) and the admin
--     SECURITY DEFINER RPCs (approval, staff scopes).
-- Safe to re-run.
-- ============================================================================

drop policy if exists profiles_update_own on public.profiles;
revoke insert, update, delete, truncate on public.profiles from anon, authenticated;

create or replace function public.guard_profile_direct_write()
returns trigger language plpgsql as $$
begin
  -- Inside SECURITY DEFINER RPCs current_user is the function owner, so only
  -- raw Data API writes by client roles land here.
  if current_user in ('anon', 'authenticated') then
    raise exception 'PROFILE_DIRECT_WRITE_FORBIDDEN';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_guard_profile_direct_write on public.profiles;
create trigger trg_guard_profile_direct_write
  before insert or update or delete on public.profiles
  for each row execute function public.guard_profile_direct_write();

-- ── participant RPCs ────────────────────────────────────────────────────────
create or replace function public.update_my_profile(
  p_full_name text,
  p_phone     text,
  p_college   text,
  p_course    text,
  p_year      text
)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_college text := btrim(coalesce(p_college, ''));
  v_course text := btrim(coalesce(p_course, ''));
  v_year text := btrim(coalesce(p_year, ''));
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Same limits as lib/validation/auth.ts profileSchema.
  if char_length(v_name) not between 2 and 80
     or v_phone !~ '^[0-9+\-\s]{7,15}$'
     or char_length(v_college) not between 2 and 120
     or char_length(v_course) not between 1 and 80
     or char_length(v_year) not between 1 and 20 then
    raise exception 'INVALID_PROFILE';
  end if;

  update public.profiles set
    full_name = v_name, phone = v_phone, college = v_college,
    course = v_course, year = v_year
  where id = v_uid
  returning * into v_row;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  return v_row;
end $$;

create or replace function public.set_my_profile_photo(p_url text)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles;
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_url is not null and (
       char_length(v_url) > 500
       or v_url !~ ('^https://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/profile-images/'
                    || v_uid::text || '/[A-Za-z0-9._-]+$')) then
    raise exception 'INVALID_PHOTO_URL';
  end if;

  update public.profiles set profile_photo = v_url
  where id = v_uid
  returning * into v_row;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  return v_row;
end $$;

revoke execute on function public.update_my_profile(text, text, text, text, text) from public, anon;
revoke execute on function public.set_my_profile_photo(text) from public, anon;
grant execute on function public.update_my_profile(text, text, text, text, text) to authenticated;
grant execute on function public.set_my_profile_photo(text) to authenticated;
