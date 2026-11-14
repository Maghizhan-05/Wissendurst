# Wissendurst'27

Wissendurst'27 is a full-stack medical-symposium platform for publishing events, onboarding participants, handling solo and team registrations, collecting UPI payment evidence, and operating the symposium from a scoped administration console.

The application supports approval-free signup with college-ID evidence, capacity-safe registration and payment workflows, General Registration, event-specific administrators, editable public content, and optional consent-first analytics.

## Technology

- Next.js 16 App Router and React 19
- TypeScript and Tailwind CSS 4
- Supabase Auth, Postgres, Storage, Row Level Security, and database RPCs
- React Three Fiber, Framer Motion, and Recharts
- PostHog Cloud EU and Vercel Web Analytics, both optional
- OCR.space-assisted UPI reference extraction, with manual entry as fallback

## Prerequisites

- Node.js 20 or newer
- npm
- A Supabase project
- Supabase CLI if you want to apply migrations from the terminal
- Optional: an OCR.space API key
- Optional: PostHog Cloud EU and Vercel projects for analytics

## Clone and install

```bash
git clone https://github.com/Maghizhan-05/Wissendurst.git
cd Wissendurst
npm install
cp .env.example .env.local
```

## Environment configuration

Fill `.env.local` with your own project values. Never commit this file.

| Variable | Required | Exposure | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Browser-safe | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Browser-safe | Supabase publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | **Server only** | Privileged server operations and signed private-storage URLs |
| `OCR_PROVIDER` | No | Server only | OCR adapter; defaults to `ocrspace` |
| `OCR_API_KEY` | No | **Server only** | Enables OCR-assisted transaction-reference extraction |
| `NEXT_PUBLIC_UPI_ID` | For payment fallback | Browser-visible | Default UPI virtual payment address |
| `NEXT_PUBLIC_UPI_PAYEE_NAME` | For payment fallback | Browser-visible | Default payee name shown with the UPI QR |
| `NEXT_PUBLIC_SITE_URL` | Yes | Browser-safe | Canonical origin used by metadata, redirects, and analytics filtering |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | No | Browser-safe | Public PostHog project token; leave empty to disable consent controls and collection |
| `POSTHOG_PERSONAL_API_KEY` | No | **Server only** | Read-only credential for the private analytics dashboard |
| `POSTHOG_PROJECT_ID` | No | **Server only** | Numeric PostHog project ID for dashboard queries |

`SUPABASE_SERVICE_ROLE_KEY`, `POSTHOG_PERSONAL_API_KEY`, and OCR credentials must never use a `NEXT_PUBLIC_` prefix or appear in client code.

## Database setup

Apply every SQL file in `supabase/migrations/` in filename order. Do not skip older files: later migrations intentionally replace and harden functions created earlier in the sequence.

### Supabase CLI

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

### Supabase SQL editor

If you are not using the CLI, open the SQL editor and run each file from `supabase/migrations/` in lexical order. Stop on the first error rather than continuing with a partially migrated schema.

`supabase/seed/seed.sql` contains optional sample event data. Apply it only after all migrations and only when you want the sample catalogue.

## Create the first super administrator

1. Start the application and complete a normal signup using the email that should own the installation.
2. Confirm that the profile exists in `public.profiles`.
3. Run the following once in the Supabase SQL editor, replacing the email address:

```sql
do $$
declare
  v_profile_id uuid;
begin
  select id
    into v_profile_id
    from public.profiles
   where lower(email) = lower('you@example.com')
   for update;

  if v_profile_id is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  update public.profiles
     set role = 'admin',
         is_super_admin = true,
         admin_scopes = '{}'::text[]
   where id = v_profile_id;

  perform public.participant_id_sync_role(
    v_profile_id,
    v_profile_id,
    'first super-admin bootstrap'
  );
end $$;

select email, role, is_super_admin, participant_id
  from public.profiles
 where lower(email) = lower('you@example.com');
```

On a clean installation, the first super administrator receives `supadmin/01`. The private analytics area is intentionally restricted to that exact participant ID in addition to the admin and super-admin checks.

After the first bootstrap, manage roles and scopes through the admin interface. Do not promote accounts with a role-only SQL update because staff participant-ID allocation must change atomically with the role.

## Supabase authentication settings

- Add `http://localhost:3000/auth/callback` and your production `/auth/callback` URL to **Authentication → URL Configuration → Redirect URLs**.
- Email confirmation may remain enabled. If you disable it, users move directly into the profile-completion/signup flow.
- Signup is approval-free once the required profile and college-ID information is complete. Incomplete profiles continue through `/application`; banned accounts are routed to `/blocked`.

## Run locally

```bash
npm run dev
```

Open `http://localhost:3000`.

Production-style local run:

```bash
npm run build
npm start
```

## Useful commands

```bash
npm run test:unit   # Node test suites
npm run typecheck   # Next route generation + TypeScript
npm run lint        # ESLint
npm run build       # Production build
npm run test:db     # Disposable local PostgreSQL migration/business-rule tests
```

`npm run test:db` never connects to your Supabase project. It requires local PostgreSQL server binaries (`initdb`, `pg_ctl`, and `psql`) on `PATH`, or their directory supplied through `PG_BIN`.

## Product areas

### Public experience

- Landing page, Events catalogue and event detail pages
- Schedule, About, and General Registration pages
- Light and dark themes, optional admin-managed backgrounds, and responsive 3D presentation
- Event categories, filter groups, team pricing, timed price windows, directed offers, coordinator contacts, and event rules

### Participant experience

- Email/password signup and password recovery
- Approval-free profile completion with private college-ID upload
- Permanent participant IDs and stable team codes
- Solo and team registration, payment-intent resume/retry, UPI evidence upload, and registration history
- General Registration with a dedicated payment identity and covered-event benefits

### Administration

- Scoped access for Events, Payments, Users, Content, and Collections
- Additive event-specific Events/Payments assignments
- Event, category, filter, pricing, offer, content, appearance, schedule, and social-link management
- Registration, payment, user, ID-card, team, collection, and export workflows
- Super-admin role management and evidence-preserving account ban/unban

## Architecture and security

- Supabase Row Level Security and table grants are the database boundary; interface visibility is not treated as authorization.
- Business-critical registration, payment, capacity, pricing, identity, and role transitions use transaction-safe `SECURITY DEFINER` functions.
- Money is stored as integer paise. Transaction-reference uniqueness is enforced in the database.
- Payment screenshots and college IDs use private Storage buckets and short-lived signed URLs.
- Privileged keys stay in server-only modules. The browser receives only publishable Supabase and optional public analytics configuration.
- Protected Next.js routes re-check the authenticated profile and required global or event-scoped capability on the server.
- Public content settings are validated before storage; administrators cannot inject arbitrary HTML, CSS, or scripts.

## Optional analytics

Analytics is disabled when `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` is empty. When configured, PostHog Cloud EU and Vercel Web Analytics run only after affirmative consent on the approved public routes; GPC or DNT prevents collection. Auth, application, participant, payment, and admin routes remain excluded.

The private `/admin/analytics` dashboard uses server-side aggregate PostHog queries and saved heatmap screenshots. Configure `POSTHOG_PERSONAL_API_KEY` with project-scoped `query:read` and `heatmap:read`, plus `POSTHOG_PROJECT_ID`. Access requires an admin, super-admin, and the exact participant ID `supadmin/01`. No visitor list, raw replay, session drill-down, or raw exception payload is displayed in the application.

## Deploy to Vercel

1. Import the Git repository into Vercel.
2. Add the required values from `.env.example`; use production values for `NEXT_PUBLIC_SITE_URL` and Supabase.
3. Keep all server-only values outside Preview/Development unless those environments need their own isolated services.
4. Add the production `/auth/callback` URL to Supabase Authentication redirect URLs.
5. Deploy and verify signup, private Storage access, registration, payment, and administrator permissions with non-production test accounts before opening registration.
6. If analytics is enabled, configure its variables for the intended environment and verify both decline and consent paths.

## Troubleshooting

### `supabaseUrl is required`

`NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is missing from `.env.local`. Restart the development server after changing environment values.

### Signup succeeds but no profile appears

Confirm that every migration completed successfully and that the auth-user profile trigger exists. Do not re-run only the initial migration over a partially migrated project.

### Payment or college-ID image does not load for an administrator

Confirm the Storage migrations were applied, the server has `SUPABASE_SERVICE_ROLE_KEY`, and the signed-in administrator has the relevant Payments or Users permission.

### OCR does not find a transaction reference

Set `OCR_API_KEY`, or continue with manual reference entry. OCR proposes a value; it never verifies payment automatically.

### Analytics says “not configured” or heatmaps are unavailable

Set the server-only PostHog project ID and personal key. The key requires `query:read`; saved heatmaps additionally require `heatmap:read`. Create and save at least one heatmap for an approved public page in PostHog if the gallery is empty.
