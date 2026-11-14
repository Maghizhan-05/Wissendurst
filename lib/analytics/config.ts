/**
 * PostHog configuration constants (D-024). Pure — no SDK import.
 *
 * The ingestion host is fixed to PostHog Cloud EU. The only accepted
 * configuration is the public project token in
 * NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN; when it is missing or malformed the
 * whole analytics feature is inert (no consent UI, no SDK, no network).
 */

export const POSTHOG_API_HOST = "https://eu.i.posthog.com";

/** PostHog public project tokens look like `phc_` + an alphanumeric key. */
const PROJECT_TOKEN_PATTERN = /^phc_[A-Za-z0-9]{20,80}$/;

/** A well-formed project token, or null (missing/blank/malformed → inert). */
export function parseProjectToken(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  const token = raw.trim();
  return PROJECT_TOKEN_PATTERN.test(token) ? token : null;
}

/** Server-side read of the configured token (null = analytics disabled). */
export function configuredProjectToken(): string | null {
  return parseProjectToken(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN);
}
