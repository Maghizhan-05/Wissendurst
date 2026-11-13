-- ============================================================================
-- WISSENDURST'27 — 0033_site_backgrounds
--
-- Pre-analytics restructuring, phase 2 (approved).
--   Light/dark background images for the whole site, uploaded by content
--   admins into a public `site-images` bucket (backgrounds/ folder), plus
--   opacity, overlay colour/strength, position, size and repeat.
--   site_settings.backgrounds is validated here (allowlisted keys, bounded
--   numbers, #rrggbb, enumerated keywords, safe object paths that must exist
--   in the bucket) so nothing but these values can ever reach the CSS.
--   Uploads happen server-side (service role); clients can't write the bucket.
-- Safe to re-run.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-images', 'site-images', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

alter table public.site_settings add column if not exists backgrounds jsonb not null default '{}'::jsonb;

-- {} or { light?: "backgrounds/<file>", dark?: …, opacity, overlay_color,
--        overlay_strength, position, size, repeat }
create or replace function public.site_backgrounds_error(p jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'NOT_OBJECT'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('light', 'dark', 'opacity', 'overlay_color', 'overlay_strength', 'position', 'size', 'repeat') then
      return 'UNKNOWN_KEY';
    end if;
  end loop;
  if p ? 'light' and p->'light' <> 'null'::jsonb
     and (jsonb_typeof(p->'light') <> 'string' or (p->>'light') !~ '^backgrounds/[A-Za-z0-9._-]{1,100}$') then
    return 'INVALID_LIGHT';
  end if;
  if p ? 'dark' and p->'dark' <> 'null'::jsonb
     and (jsonb_typeof(p->'dark') <> 'string' or (p->>'dark') !~ '^backgrounds/[A-Za-z0-9._-]{1,100}$') then
    return 'INVALID_DARK';
  end if;
  if p ? 'opacity' and (jsonb_typeof(p->'opacity') <> 'number' or (p->>'opacity') !~ '^[0-9]+$'
     or (p->>'opacity')::int not between 5 and 100) then
    return 'INVALID_OPACITY';
  end if;
  if p ? 'overlay_strength' and (jsonb_typeof(p->'overlay_strength') <> 'number' or (p->>'overlay_strength') !~ '^[0-9]+$'
     or (p->>'overlay_strength')::int not between 0 and 90) then
    return 'INVALID_OVERLAY_STRENGTH';
  end if;
  if p ? 'overlay_color' and (jsonb_typeof(p->'overlay_color') <> 'string' or (p->>'overlay_color') !~ '^#[0-9a-fA-F]{6}$') then
    return 'INVALID_OVERLAY_COLOR';
  end if;
  if p ? 'position' and (p->>'position') not in ('top', 'center', 'bottom') then return 'INVALID_POSITION'; end if;
  if p ? 'size' and (p->>'size') not in ('cover', 'contain', 'auto') then return 'INVALID_SIZE'; end if;
  if p ? 'repeat' and jsonb_typeof(p->'repeat') <> 'boolean' then return 'INVALID_REPEAT'; end if;
  return null;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'site_settings_backgrounds_valid') then
    alter table public.site_settings add constraint site_settings_backgrounds_valid
      check (public.site_backgrounds_error(backgrounds) is null);
  end if;
end $$;

-- Referenced images must exist in the bucket (checked on write).
create or replace function public.guard_site_backgrounds()
returns trigger language plpgsql security definer set search_path = public, storage as $$
declare m text;
begin
  if tg_op = 'UPDATE' and new.backgrounds is not distinct from old.backgrounds then
    return new;
  end if;
  -- Malformed values are left to the check constraint (clearer error).
  if public.site_backgrounds_error(new.backgrounds) is not null then
    return new;
  end if;
  foreach m in array array['light', 'dark'] loop
    if coalesce(new.backgrounds->>m, '') <> ''
       and not exists (select 1 from storage.objects o where o.bucket_id = 'site-images' and o.name = new.backgrounds->>m) then
      raise exception 'BACKGROUND_IMAGE_NOT_FOUND' using detail = m;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists site_settings_guard_backgrounds on public.site_settings;
create trigger site_settings_guard_backgrounds
  before insert or update of backgrounds on public.site_settings
  for each row execute function public.guard_site_backgrounds();
