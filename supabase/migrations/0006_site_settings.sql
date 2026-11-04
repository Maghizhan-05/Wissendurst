-- ============================================================================
-- WISSENDURST'27 — 0006_site_settings
-- Editable landing-page content. A single-row table (id = 1) holding a JSONB
-- blob that the app merges over its built-in defaults.
-- ============================================================================

create table if not exists public.site_settings (
  id         int primary key default 1 check (id = 1),
  content    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.site_settings (id, content)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

drop trigger if exists trg_site_settings_updated on public.site_settings;
create trigger trg_site_settings_updated before update on public.site_settings
  for each row execute function public.set_updated_at();

alter table public.site_settings enable row level security;

-- Public read (the landing page is public), admin-only writes.
drop policy if exists site_settings_read on public.site_settings;
create policy site_settings_read on public.site_settings
  for select using (true);

drop policy if exists site_settings_admin_write on public.site_settings;
create policy site_settings_admin_write on public.site_settings
  for all using (public.is_admin()) with check (public.is_admin());
