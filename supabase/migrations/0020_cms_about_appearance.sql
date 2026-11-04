-- ============================================================================
-- WISSENDURST'27 — 0020_cms_about_appearance
-- (1) site_settings gains two independent JSON columns so each editor saves
--     only its own document: `about` (About page) and `appearance` (validated
--     light/dark colour overrides). `content` (home page) is unchanged.
-- (2) appearance is constrained in the database too: only {light, dark}
--     objects whose keys are allowlisted colour tokens and whose values are
--     #rrggbb strings. Arbitrary CSS can never be stored.
-- (3) Data fix: correct the old "Wissendrust" spelling inside the saved home
--     page JSON (string values only; nothing else in the document changes).
-- Forward-only and safe to re-run.
-- ============================================================================

alter table public.site_settings
  add column if not exists about jsonb not null default '{}'::jsonb,
  add column if not exists appearance jsonb not null default '{}'::jsonb;

create or replace function public.site_appearance_is_valid(p jsonb)
returns boolean
language sql immutable set search_path = public as $$
  select jsonb_typeof(p) = 'object'
    and not exists (
      select 1 from jsonb_each(p) m
      where m.key not in ('light', 'dark')
         or jsonb_typeof(m.value) <> 'object'
         or exists (
           select 1 from jsonb_each(m.value) t
           where t.key not in (
                   'background', 'surface', 'surface-2', 'foreground', 'muted',
                   'border', 'brand', 'brand-2', 'brand-contrast', 'success',
                   'warning', 'alert', 'ring')
              or jsonb_typeof(t.value) <> 'string'
              or (t.value #>> '{}') !~ '^#[0-9a-fA-F]{6}$'
         )
    );
$$;

alter table public.site_settings
  drop constraint if exists site_settings_appearance_valid;
alter table public.site_settings
  add constraint site_settings_appearance_valid
  check (public.site_appearance_is_valid(appearance));

alter table public.site_settings
  drop constraint if exists site_settings_about_object;
alter table public.site_settings
  add constraint site_settings_about_object
  check (jsonb_typeof(about) = 'object');

-- (3) Spelling fix. "Wissendrust" can't occur in JSON syntax and the
-- replacement adds no special characters, so a textual replace only edits
-- string values that contain the misspelling.
update public.site_settings
   set content = replace(replace(replace(content::text,
                   'Wissendrust', 'Wissendurst'),
                   'wissendrust', 'wissendurst'),
                   'WISSENDRUST', 'WISSENDURST')::jsonb
 where content::text ~* 'wissendrust';
