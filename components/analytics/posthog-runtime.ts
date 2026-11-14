"use client";

/**
 * The only module that imports the PostHog SDK (D-024). It is loaded with a
 * dynamic import by the analytics provider after affirmative consent on an
 * approved public route, using the official bundle with every extension
 * compiled in (no external scripts are fetched).
 */
import posthog from "posthog-js/dist/module.full.no-external";
import { buildPostHogConfig } from "@/lib/analytics/posthog-options";
import { bridge, liveAnalyticsAllowed, type AnalyticsRuntime } from "./bridge";

let initialized = false;
/** Replay stopped because the page left an approved route (or consent ended). */
let suspended = false;
/** Consent withdrawn in this tab; cleared only by a fresh grant. */
let revoked = false;

/**
 * Event gate, evaluated live at send time. Deliberately independent of the
 * React-driven `suspended` flag: a client navigation back to an approved
 * route fires its history_change $pageview before the provider re-renders,
 * and the live location/consent check is the authoritative boundary anyway.
 */
function mayCapture(): boolean {
  return !revoked && liveAnalyticsAllowed();
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
  revoked = false;
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
  captureError(error) {
    if (!mayCapture()) return;
    // No additional properties: the message/stack are redacted by before_send.
    posthog.captureException(error);
  },
  suspend() {
    suspended = true;
    if (initialized) posthog.stopSessionRecording();
  },
  resume() {
    if (!initialized || revoked || !bridge.granted) return;
    if (!suspended) return;
    suspended = false;
    posthog.startSessionRecording();
  },
  revoke() {
    if (!initialized) return;
    if (mayCapture()) posthog.capture("consent_denied", {}, { send_instantly: true });
    revoked = true;
    suspended = true;
    posthog.stopSessionRecording();
    // reset() restores the default (opted-out) consent; opt out explicitly after.
    posthog.reset(true);
    posthog.opt_out_capturing();
    clearPostHogStorage();
  },
};
