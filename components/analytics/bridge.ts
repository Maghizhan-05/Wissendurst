"use client";

/**
 * Analytics bridge (D-024). Holds the live consent/route state and the
 * PostHog runtime once it has been loaded. Contains NO PostHog import: the
 * SDK lives in ./posthog-runtime and is fetched with a dynamic import only
 * after consent, on an approved route, with a configured token.
 */
import type { CustomEventName } from "@/lib/analytics/sanitize";
import type { CustomEventProps } from "@/lib/analytics/events";

export interface AnalyticsRuntime {
  track<E extends CustomEventName>(event: E, props: CustomEventProps[E]): void;
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

/** Records a typed product event when (and only when) analytics is active. */
export function track<E extends CustomEventName>(event: E, props: CustomEventProps[E]): void {
  if (!bridge.granted || !bridge.routeAllowed || !bridge.runtime) return;
  try {
    bridge.runtime.track(event, props);
  } catch {
    // Analytics must never break the page.
  }
}
