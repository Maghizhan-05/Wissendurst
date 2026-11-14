/**
 * Analytics route policy (D-024). Pure.
 *
 * PostHog may load and operate ONLY on these public routes:
 *   /  /events  /events/[slug]  /about  /schedule  /general-registration
 * Everything else — sign-in/sign-up/password flows, /application,
 * /pending-approval, /blocked, every /dashboard (payments, profile,
 * registrations) and every /admin route — is denied, as is anything unknown.
 */

const EXACT = new Set(["/", "/events", "/about", "/schedule", "/general-registration"]);
/** Same shape as event slugs (lowercase words joined by single hyphens). */
const EVENT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PATH_LENGTH = 200;

/** Normalizes a pathname (no query/hash; trailing slash removed). Null if unusable. */
export function normalizePathname(pathname: string | null | undefined): string | null {
  if (typeof pathname !== "string" || pathname.length === 0 || pathname.length > MAX_PATH_LENGTH) return null;
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return null;
  if (/[?#\\\s%]/.test(pathname)) return null;
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return p === "" ? "/" : p;
}

/** The public event slug of an /events/[slug] path, else null. */
export function eventSlugFromPath(pathname: string | null | undefined): string | null {
  const p = normalizePathname(pathname);
  if (!p) return null;
  const m = /^\/events\/([^/]+)$/.exec(p);
  return m && EVENT_SLUG.test(m[1]) && m[1].length <= 120 ? m[1] : null;
}

/** True only for the six approved public routes. */
export function isAnalyticsRoute(pathname: string | null | undefined): boolean {
  const p = normalizePathname(pathname);
  if (!p) return false;
  return EXACT.has(p) || eventSlugFromPath(p) !== null;
}

/** Same-origin URL patterns for PostHog's autocapture `url_allowlist`. */
export function autocaptureUrlAllowlist(origin: string): RegExp[] {
  const o = origin.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return [
    new RegExp(`^${o}/?$`),
    new RegExp(`^${o}/(events|about|schedule|general-registration)/?$`),
    new RegExp(`^${o}/events/[a-z0-9]+(?:-[a-z0-9]+)*/?$`),
  ];
}
