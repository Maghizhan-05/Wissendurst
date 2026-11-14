# Wissendurst'27

A premium medical-symposium website with a full event-management system:
discovery → registration → UPI/QR payment → OCR-assisted verification →
duplicate detection → admin review → confirmed registration.

**Stack:** Next.js 16 (App Router, RSC-first) · React 19 · TypeScript ·
Tailwind CSS v4 · Supabase (Postgres, Auth, Storage, RLS) · React Three Fiber ·
Framer Motion · Zod.

---

## 1. Prerequisites

- **Node.js 20+** (built and verified on Node 24)
- A **Supabase** project (free tier is fine)
- An **OCR.space** API key for payment OCR (free tier works) — optional; the app
  degrades to manual transaction-ID entry without it.

## 2. Install

```bash
npm install
```

## 3. Environment

Copy the example and fill in real values:

```bash
cp .env.example .env.local
```

| Variable                               | Where                             | Notes                              |
| -------------------------------------- | --------------------------------- | ---------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase → Project Settings → API | public                             |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | same                              | public                             |
| `SUPABASE_SERVICE_ROLE_KEY`            | same                              | **server only — never expose**     |
| `OCR_PROVIDER`                         | —                                 | `ocrspace` (default)               |
| `OCR_API_KEY`                          | https://ocr.space/ocrapi          | server only                        |
| `NEXT_PUBLIC_UPI_ID`                   | your college UPI VPA              | shown on payment page              |
| `NEXT_PUBLIC_UPI_PAYEE_NAME`           | payee display name                | shown on payment page              |
| `NEXT_PUBLIC_SITE_URL`                 | e.g. `http://localhost:3000`      | used for OG/sitemap/auth redirects |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`    | PostHog (EU) → Project settings   | optional, public `phc_…`; empty = analytics fully off |

`.env.local` is gitignored. The service-role key is only ever imported by
`lib/supabase/admin.ts`, which is marked `server-only` so a build fails if it is
ever pulled into a client bundle.

## 4. Database setup

Run the SQL files **in order** in the Supabase SQL editor (or via the CLI):

```
supabase/migrations/0001_init.sql      -- enums, tables, participant-ID gen, triggers, indexes
supabase/migrations/0002_rls.sql       -- Row Level Security policies
supabase/migrations/0003_functions.sql -- register_for_event, submit_payment, admin_set_payment_status
supabase/migrations/0004_storage.sql   -- buckets + storage policies
supabase/seed/seed.sql                 -- sample events (optional)
```

With the Supabase CLI:

```bash
supabase db push          # if using CLI migrations
# or paste each file into the SQL editor and run
```

### Make yourself an admin

1. Sign up through the app (creates the auth user + profile via trigger).
2. In the SQL editor:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

### Auth settings

- For the smoothest UX, disable "Confirm email" in
  **Supabase → Authentication → Providers → Email** (users then land straight in
  the dashboard after signup). If left enabled, users must confirm via email
  first; the app handles both paths.
- Add `${NEXT_PUBLIC_SITE_URL}/auth/callback` to **Authentication → URL
  Configuration → Redirect URLs** (for email confirmation and password reset).

## 5. Run

```bash
npm run dev      # http://localhost:3000
npm run build    # production build
npm start        # serve the production build
```

---

## Architecture

### Route groups (`app/`)

```
(public)/   landing, /events, /events/[slug], /about, /schedule   ← immersive
(auth)/     login, signup, forgot-password, reset-password
dashboard/  profile, registrations (flip cards), payment/[id]      ← user zone
admin/      overview, events, registrations, payments, users       ← dense, functional
auth/callback   PKCE code exchange for email links
```

### Security model

- **RLS is the source of truth.** UI gating is cosmetic; every table has
  policies (`0002_rls.sql`). Admin checks use a `SECURITY DEFINER` `is_admin()`
  function to avoid recursive policy evaluation.
- **Server-side authorization** on protected routes via `proxy.ts` (session
  refresh + redirects) and `requireProfile()` / `requireAdmin()` in layouts.
- **Privileged writes go through `SECURITY DEFINER` RPCs**, not raw table writes:
  - `register_for_event` — capacity-safe (advisory lock), prevents double-registration.
  - `submit_payment` — duplicate-aware transaction attachment.
  - `admin_set_payment_status` — the only path to `verified`; writes an audit row.
- The **service-role key** is used only server-side for the two things RLS can't
  express cleanly: none of the normal flows — it is limited to generating signed
  URLs for private payment screenshots in the admin review screen.

### Payment + duplicate detection

- Screenshots go to the **private** `payment-screenshots` bucket (owner-scoped
  upload; reads via short-lived signed URLs for the owner/admin only).
- OCR runs **server-side** (`lib/ocr/`, `paymentVerificationService`) — the key
  never reaches the browser. It only proposes a reference; it never auto-verifies.
- Duplicate transaction IDs are enforced by a **partial unique index**
  (`uq_registrations_txn`). `submit_payment` marks a colliding submission
  `duplicate` and records the original registration in `duplicate_of`.
- Money is stored as **integer paise** throughout.

### OCR is pluggable

`lib/ocr/index.ts` exposes one seam. Swap `OCR_PROVIDER` and add an adapter in
`lib/ocr/providers/` (Google Vision, Textract, Tesseract, …) without touching
callers. UTR/reference parsing lives in a pure, testable module (`lib/ocr/utr.ts`).

### Design system

- Two intentionally-designed themes (clinical-lab dark / clean-conference light)
  via CSS variables mapped into Tailwind v4 `@theme`; `next-themes` persists the
  choice and respects `prefers-color-scheme`.
- 3D hero (`components/three/`) is lazy-loaded (`ssr: false`) and disabled under
  `prefers-reduced-motion`.
- Reusable primitives in `components/ui/`, feature components grouped by domain.

---

## Testing checklist

- **Auth:** signup → participant ID appears (5 chars, no ambiguous letters) →
  logout → login → forgot/reset password.
- **Events:** create/edit/delete in admin → appears at `/events` and `/events/[slug]`.
- **Registration:** register for multiple events; try registering twice (blocked);
  fill an event to capacity (blocked).
- **Payment:** open payment page → QR renders → upload screenshot → OCR proposes a
  reference → confirm → status `under_review`. Submit the **same** transaction ID
  on another registration → marked `duplicate`.
- **Admin:** overview stats, duplicate alert, review screen (screenshot + verify/
  reject/flag), user role toggle.
- **UI:** desktop/tablet/mobile, light/dark, flip cards (hover + tap).

## Deployment (Vercel)

1. Push to a Git repo and import into Vercel.
2. Add all env vars from `.env.example` (set `NEXT_PUBLIC_SITE_URL` to the prod URL).
3. Update Supabase **Redirect URLs** to include `https://your-domain/auth/callback`.
4. Deploy. OCR.space runs fine on Vercel serverless functions.

## Analytics (PostHog Cloud EU, consent-first — D-024)

Analytics is **off unless `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` is set** (a public
`phc_…` project token). Without it nothing renders, loads or connects: no consent
banner, no "Cookie preferences" control, no SDK chunk, no PostHog requests.

With a token:

- **Consent first.** A banner on `/` only (equal Accept / Decline). The choice is
  a versioned first-party cookie `wd_analytics_consent` (`v1.granted` /
  `v1.denied`, one year, `Path=/`, `SameSite=Lax`, `Secure` in production).
  "Cookie preferences" in the footer reopens it. **Global Privacy Control or Do
  Not Track is an absolute "no"** that no click overrides; it is never stored.
- **SDK only after consent**, via a dynamic import of
  `posthog-js/dist/module.full.no-external` (all extensions compiled in;
  `disable_external_dependency_loading`). Host fixed to `https://eu.i.posthog.com`.
- **Routes:** PostHog operates only on `/`, `/events`, `/events/[slug]`, `/about`,
  `/schedule`, `/general-registration` (`lib/analytics/routes.ts`). It is never
  mounted on sign-in/sign-up/password, `/application`, `/pending-approval`,
  `/blocked`, `/dashboard/**` or `/admin/**`; client navigation away stops replay
  and suspends capture at once.
- **Captured after consent:** page views/leaves, click/submit autocapture,
  click heatmaps, scroll depth (scrollmaps), masked session replay, and four
  typed events: `consent_granted`, `consent_denied` (on withdrawal),
  `registration_started`, `free_registration_confirmed`. No server-side
  analytics, no payment events, never `identify()` (`person_profiles:
  'identified_only'`).
- **Privacy:** all inputs masked; replay text masked except reviewed static
  copy marked `data-ph-unmask`; images, canvas, QR codes, coordinator/footer
  contacts, team rosters, the General Registration status/payment panel and the
  navbar participant ID are blocked (`ph-no-capture`). Every event passes
  `lib/analytics/sanitize.ts` before send: same-origin pathname only (no query,
  hash or referrer), allow-listed events/properties only, PII-shaped values
  removed. Surveys, flags, console, network, canvas and site apps are disabled
  (`lib/analytics/posthog-options.ts`).

### Error tracking, Vercel Web Analytics and the admin dashboard (D-025)

- **PostHog error tracking** shares the same gate: consent + approved public
  route only. Uncaught errors and unhandled rejections are captured natively
  (`capture_exceptions`, never console errors), plus handled render errors from
  `app/(public)/error.tsx` via the bridge (`captureError`). A token-bucket rate
  limit (burst 5, refill 1/s) and no exception steps. Every `$exception` passes
  the same `before_send` sanitizer, which keeps only `$exception_list`
  (type/value/mechanism/stack frames), `$exception_level` and `$release_id`, and
  recursively redacts emails, phones, UUIDs, participant/staff IDs, UPI and
  transaction references, JWT/token-like strings, URL query/hash data,
  uploaded/storage URLs and filenames and long numbers
  (`lib/analytics/redact.ts`). Frame source context and variables are dropped;
  only same-origin script paths survive. Sensitive routes never report.
- **Vercel Web Analytics** (`@vercel/analytics/next`, one `<Analytics />` in
  `components/analytics/vercel-analytics.tsx`) is mounted only while the same
  PostHog consent is granted on an approved route; it shares no other state.
  Its injected script outlives an unmount, so its `beforeSend`
  (`lib/analytics/vercel.ts`) re-checks live consent, GPC/DNT and route at
  send time, reduces the URL to the pathname and drops a repeated pageview for
  the same path. No manual Vercel or PostHog pageviews: PostHog uses
  `capture_pageview: 'history_change'` + `capture_pageleave: true`, Vercel
  uses its own route tracking — one source per tool. (Vercel may send the
  referrer, which browsers reduce to the origin for cross-site visits.)
- **`/admin/analytics`** (super admins only, `requireSuperAdmin()`): 30-day
  aggregates — page views, sessions, top public paths, the
  `registration_started → free_registration_confirmed` funnel, exception volume
  and top exception types — read server-side from the PostHog EU Query API
  (`lib/analytics/dashboard.ts`, `lib/data/analytics-dashboard.ts`). No
  visitors, distinct IDs, sessions, replays or exception payloads; the page
  loads no client analytics SDK. Missing or rejected credentials show a
  "not configured" / "rejected" notice instead of failing.

### Remaining console / provider actions (owner)

1. **Vercel → Project → Analytics → Enable Web Analytics** (it serves
   `/_vercel/insights/*`; until enabled, the script 404s harmlessly). Optional:
   an Analytics spend/usage limit.
2. **PostHog → Error tracking:** turn on exception autocapture for the
   project (the SDK only sends after consent; remote config is still subject to
   the code-level settings). Set alerts if wanted.
3. **Source maps (optional, gated):** stacks are minified until source maps
   are uploaded. Uploading needs a PostHog **personal API key with
   error-tracking write** in the *build* environment
   (`@posthog/nextjs-config` / `posthog-cli sourcemap`). It is **not** set up in
   this repository; adding it is a separate approval. Never serve source maps
   publicly.
4. **Dashboard read credential:** PostHog → Settings → Personal API keys →
   create a key scoped to **this project only** with **`query:read`** only. In
   Vercel (Production, *not* exposed to the browser) set
   `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` (numeric, from Project
   settings), then redeploy. Rotate it if ever leaked; never prefix it
   `NEXT_PUBLIC_`.

### PostHog console checklist (owner)

1. Create the project in the **EU** region (`eu.posthog.com`).
2. Copy the project's public token into Vercel → Environment Variables as
   `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` for **Production only** (Preview and
   Development stay empty/inert), then redeploy.
3. Project settings → **Authorized URLs**: only the exact production origin.
4. Project settings → **Discard client IP data**: on.
5. Session replay: enable it, and choose the **shortest useful retention**.
6. Billing → set a **usage alert** / keep within the free tier (autocapture and
   replay add volume).
7. **No data pipelines / destinations / site apps.**
8. Keep project membership restricted to the owner account.

## Troubleshooting

- **"supabaseUrl is required" at runtime** → env vars not set in `.env.local`.
- **Signup succeeds but no profile** → the `on_auth_user_created` trigger didn't
  run; re-check `0001_init.sql` executed fully.
- **Payment screenshot won't load in admin** → confirm `0004_storage.sql` ran and
  `SUPABASE_SERVICE_ROLE_KEY` is set.
- **OCR always returns no reference** → `OCR_API_KEY` missing; manual entry still works.
