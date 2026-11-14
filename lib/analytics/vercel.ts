/**
 * Vercel Web Analytics gate (D-025). Pure.
 *
 * Shares D-024's boundary: the official `<Analytics />` integration is
 * mounted only while consent is granted on an approved public route, and —
 * because the injected script outlives an unmount — every event also passes
 * this `beforeSend`, which re-checks the LIVE consent/route state, reduces the
 * URL to the same-origin pathname and drops a repeated pageview for the same
 * path (e.g. a remount) so the tool never double counts.
 */
import { isAnalyticsRoute, normalizePathname } from "./routes.ts";

export interface VercelEventLike {
  type: "pageview" | "event";
  url: string;
}

export interface VercelGateDeps {
  origin: string;
  /** Consent granted, no GPC/DNT, on an approved route — read live at send time. */
  allowed: () => boolean;
  now: () => number;
}

/** Same path again within this window is the same page view (remount/race). */
export const VERCEL_DUPLICATE_WINDOW_MS = 2000;

export function createVercelBeforeSend(deps: VercelGateDeps) {
  let last: { url: string; at: number } | null = null;
  return function beforeSend<E extends VercelEventLike>(event: E): E | null {
    if (!event || (event.type !== "pageview" && event.type !== "event")) return null;
    if (!deps.allowed()) return null;
    let u: URL;
    try {
      u = new URL(event.url, deps.origin);
    } catch {
      return null;
    }
    if (u.origin !== deps.origin) return null;
    const path = normalizePathname(u.pathname);
    if (!path || !isAnalyticsRoute(path)) return null;
    const url = deps.origin + (path === "/" ? "/" : path);
    if (event.type === "pageview") {
      const t = deps.now();
      if (last && last.url === url && t - last.at < VERCEL_DUPLICATE_WINDOW_MS) return null;
      last = { url, at: t };
    }
    return { ...event, url };
  };
}
