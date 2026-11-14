"use client";

/**
 * The only module that imports the PostHog SDK (D-024). It is loaded with a
 * dynamic import by the analytics provider after affirmative consent on an
 * approved public route, using the official bundle with every extension
 * compiled in (no external scripts are fetched).
 */
import posthog from "posthog-js/dist/module.full.no-external";
import { browserSignalDenial, readConsentFromCookieString } from "@/lib/analytics/consent";
import { isAnalyticsRoute } from "@/lib/analytics/routes";
import { buildPostHogConfig } from "@/lib/analytics/posthog-options";
import { bridge, type AnalyticsRuntime } from "./bridge";

let initialized = false;
let suspended = false;

function mayCapture(): boolean {
  if (typeof window === "undefined") return false;
  return (
    !suspended &&
    bridge.granted &&
    readConsentFromCookieString(document.cookie) === "granted" &&
    !browserSignalDenial(navigator as Navigator & { globalPrivacyControl?: unknown }, window as unknown as { doNotTrack?: unknown }) &&
    isAnalyticsRoute(window.location.pathname)
  );
}

function clearPostHogStorage(): void {
  try {
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (const key of Object.keys(store)) {
        if (/^(ph_|__ph_|_posthog)/.test(key) && !key.startsWith("__ph_opt_in_out_")) store.removeItem(key);
      }
    }
    for (const c of document.cookie.split(";")) {
      const name = c.split("=")[0]?.trim();
      if (name && /^(ph_|__ph_)/.test(name)) document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    }
  } catch {
    // Storage may be unavailable (private mode); nothing to clear then.
  }
}

/** Initializes once (idempotent) and opts in. */
export function startRuntime(token: string, firstGrant: boolean): AnalyticsRuntime {
  suspended = false;
  if (!initialized) {
    posthog.init(
      token,
      buildPostHogConfig({
        origin: window.location.origin,
        pathname: () => window.location.pathname,
        mayCapture,
      }),
    );
    initialized = true;
  } else {
    posthog.startSessionRecording();
  }
  // Opting in captures the initial page view; the opt-in event itself is ours.
  posthog.opt_in_capturing({ captureEventName: false });
  if (firstGrant) posthog.capture("consent_granted", {}, { send_instantly: true });
  return runtime;
}

const runtime: AnalyticsRuntime = {
  track(event, props) {
    if (!mayCapture()) return;
    posthog.capture(event, { ...props }, { send_instantly: true });
  },
  suspend() {
    suspended = true;
    if (initialized) posthog.stopSessionRecording();
  },
  resume() {
    if (!initialized || !bridge.granted) return;
    suspended = false;
    posthog.startSessionRecording();
  },
  revoke() {
    if (!initialized) return;
    if (mayCapture()) posthog.capture("consent_denied", {}, { send_instantly: true });
    suspended = true;
    posthog.stopSessionRecording();
    // reset() restores the default (opted-out) consent; opt out explicitly after.
    posthog.reset(true);
    posthog.opt_out_capturing();
    clearPostHogStorage();
  },
};
