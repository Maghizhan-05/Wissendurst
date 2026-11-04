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

## Troubleshooting

- **"supabaseUrl is required" at runtime** → env vars not set in `.env.local`.
- **Signup succeeds but no profile** → the `on_auth_user_created` trigger didn't
  run; re-check `0001_init.sql` executed fully.
- **Payment screenshot won't load in admin** → confirm `0004_storage.sql` ran and
  `SUPABASE_SERVICE_ROLE_KEY` is set.
- **OCR always returns no reference** → `OCR_API_KEY` missing; manual entry still works.
