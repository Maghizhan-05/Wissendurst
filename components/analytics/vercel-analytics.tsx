"use client";

/**
 * The single Vercel Web Analytics mount (D-025). Rendered by the analytics
 * provider only while consent is granted on an approved public route; the
 * official Next.js integration is the one page-view source (no manual calls).
 * Its injected script outlives an unmount, so the shared live gate in
 * `beforeSend` also drops anything after withdrawal or off-route.
 */
import { Analytics } from "@vercel/analytics/next";
import { createVercelBeforeSend } from "@/lib/analytics/vercel";
import { liveAnalyticsAllowed } from "./bridge";

// Module scope: one gate (and one duplicate-pageview memory) per tab.
const beforeSend =
  typeof window === "undefined"
    ? () => null
    : createVercelBeforeSend({
        origin: window.location.origin,
        allowed: liveAnalyticsAllowed,
        now: () => Date.now(),
      });

export default function VercelAnalytics() {
  return <Analytics beforeSend={beforeSend} />;
}
