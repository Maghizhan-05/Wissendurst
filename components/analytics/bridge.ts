"use client";

/**
 * Analytics bridge (D-024/D-025). Holds the live consent/route state and the
 * PostHog runtime once it has been loaded. Contains NO SDK import: PostHog
 * lives in ./posthog-runtime and Vercel Analytics in ./vercel-analytics, both
 * loaded with dynamic imports only after consent, on an approved route, with
 * a configured token.
 */
import type { CustomEventName } from "@/lib/analytics/sanitize";
import type { CustomEventProps } from "@/lib/analytics/events";
import { browserSignalDenial, readConsentFromCookieString } from "@/lib/analytics/consent";
import { isAnalyticsRoute } from "@/lib/analytics/routes";

export interface AnalyticsRuntime {
  track<E extends CustomEventName>(event: E, props: CustomEventProps[E]): void;
  /** A handled error from an error boundary (redacted before send). */
  captureError(error: unknown): void;
  /** Leaving an approved route: stop replay, suspend all capture. */
  suspend(): void;
  /** Back on an approved route with consent: resume capture and replay. */
  resume(): void;
  /** Withdrawal: final consent_denied, stop replay, reset identity, opt out. */
  revoke(): void;
}

export const bridge: {
  granted: boolean;
  routeAllowed: boolean;
  runtime: AnalyticsRuntime | null;
} = { granted: false, routeAllowed: false, runtime: null };

/**
 * The live gate shared by both products: consent granted in this tab AND in
 * the cookie, no GPC/DNT signal, and the current page is an approved route.
 */
export function liveAnalyticsAllowed(): boolean {
  if (typeof window === "undefined") return false;
  return (
    bridge.granted &&
    readConsentFromCookieString(document.cookie) === "granted" &&
    !browserSignalDenial(
      navigator as Navigator & { globalPrivacyControl?: unknown },
      window as unknown as { doNotTrack?: unknown },
    ) &&
    isAnalyticsRoute(window.location.pathname)
  );
}

/** Records a typed product event when (and only when) analytics is active. */
export function track<E extends CustomEventName>(event: E, props: CustomEventProps[E]): void {
  if (!bridge.routeAllowed || !bridge.runtime || !liveAnalyticsAllowed()) return;
  try {
    bridge.runtime.track(event, props);
  } catch {
    // Analytics must never break the page.
  }
}

/** Reports a handled render error (public routes, consent only). */
export function captureError(error: unknown): void {
  if (!bridge.routeAllowed || !bridge.runtime || !liveAnalyticsAllowed()) return;
  try {
    bridge.runtime.captureError(error);
  } catch {
    // Never throw from error reporting.
  }
}
