-- ============================================================================
-- WISSENDURST'27 — 0004_storage
-- Buckets and storage RLS. Payment screenshots are PRIVATE (signed URLs only).
-- Convention: user-scoped files live under a top-level folder = the user id,
-- e.g. payment-screenshots/<uid>/<registration_id>.png
-- ============================================================================

insert into storage.buckets (id, name, public)
values
  ('event-images',        'event-images',        true),
  ('profile-images',      'profile-images',      true),
  ('payment-screenshots', 'payment-screenshots', false)
on conflict (id) do nothing;

-- ── event-images (public read, admin write) ─────────────────────────────────
drop policy if exists "event images public read" on storage.objects;
create policy "event images public read" on storage.objects
  for select using (bucket_id = 'event-images');

drop policy if exists "event images admin write" on storage.objects;
create policy "event images admin write" on storage.objects
  for all using (bucket_id = 'event-images' and public.is_admin())
  with check (bucket_id = 'event-images' and public.is_admin());

-- ── profile-images (public read, owner write) ───────────────────────────────
drop policy if exists "profile images public read" on storage.objects;
create policy "profile images public read" on storage.objects
  for select using (bucket_id = 'profile-images');

drop policy if exists "profile images owner write" on storage.objects;
create policy "profile images owner write" on storage.objects
  for all using (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── payment-screenshots (PRIVATE) ───────────────────────────────────────────
-- Owner may upload into their own folder. Reads are admin-only (users receive
-- signed URLs generated server-side; admins read for verification).
drop policy if exists "payment shots owner insert" on storage.objects;
create policy "payment shots owner insert" on storage.objects
  for insert with check (
    bucket_id = 'payment-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "payment shots owner select" on storage.objects;
create policy "payment shots owner select" on storage.objects
  for select using (
    bucket_id = 'payment-screenshots'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists "payment shots admin manage" on storage.objects;
create policy "payment shots admin manage" on storage.objects
  for all using (bucket_id = 'payment-screenshots' and public.is_admin())
  with check (bucket_id = 'payment-screenshots' and public.is_admin());
