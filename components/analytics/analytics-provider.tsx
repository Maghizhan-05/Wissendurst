"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import {
  browserSignalDenial,
  effectiveConsent,
  readConsentFromCookieString,
  serializeConsentCookie,
  type ConsentChoice,
  type EffectiveConsent,
  type StoredConsent,
} from "@/lib/analytics/consent";
import { isAnalyticsRoute } from "@/lib/analytics/routes";
import { bridge } from "./bridge";
import { ConsentPanel } from "./consent-panel";

/** Vercel Web Analytics chunk: fetched only when first mounted (after consent). */
const VercelAnalytics = dynamic(() => import("./vercel-analytics"), { ssr: false });

/** True once this tab has hydrated the provider (later mounts are client-only). */
let hydrated = false;

interface AnalyticsContextValue {
  consent: EffectiveConsent;
  choose: (choice: ConsentChoice) => void;
  openPreferences: () => void;
}

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

/** Consent state for the footer control; null when analytics is not configured. */
export function useAnalyticsConsent(): AnalyticsContextValue | null {
  return useContext(AnalyticsContext);
}

function subscribeFocus(onChange: () => void): () => void {
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

function liveSignal(): boolean {
  if (typeof navigator === "undefined") return false;
  return browserSignalDenial(
    navigator as Navigator & { globalPrivacyControl?: unknown },
    window as unknown as { doNotTrack?: unknown },
  );
}

/**
 * Consent-first PostHog (D-024). Mounted only by the public layout and only
 * when a project token is configured. The SDK is imported dynamically after
 * affirmative consent, never while a GPC/DNT signal is on, and runs only on
 * the approved public routes; leaving one stops replay and suspends capture.
 */
export function AnalyticsProvider({
  token,
  initialStored,
  serverSignal,
  children,
}: {
  token: string;
  initialStored: StoredConsent;
  /** Sec-GPC / DNT request header seen by the server. */
  serverSignal: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const routeAllowed = isAnalyticsRoute(pathname);
  // The cookie is the source of truth. The server-read value is used for the
  // first (hydrating) render; a client-side remount of this layout (e.g.
  // returning from /signup) may receive a cached, stale server value, so it
  // reads the live cookie instead.
  const [stored, setStored] = useState<StoredConsent>(() =>
    typeof document === "undefined" || !hydrated ? initialStored : readConsentFromCookieString(document.cookie),
  );
  useEffect(() => {
    hydrated = true;
  }, []);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const firstGrant = useRef(false);
  const loading = useRef(false);

  // The live browser signal, re-read whenever the tab regains focus (the user
  // may have toggled it). False during SSR/hydration, then the real value.
  const clientSignal = useSyncExternalStore(subscribeFocus, liveSignal, () => false);
  const signal = serverSignal || clientSignal;
  const consent = useMemo(() => effectiveConsent(stored, signal), [stored, signal]);
  const granted = consent.state === "granted";

  useEffect(() => {
    bridge.granted = granted;
    bridge.routeAllowed = routeAllowed;
    if (!granted || !routeAllowed) {
      bridge.runtime?.suspend();
      return;
    }
    if (bridge.runtime) {
      bridge.runtime.resume();
      return;
    }
    if (loading.current) return;
    loading.current = true;
    import("./posthog-runtime")
      .then((m) => {
        if (!bridge.granted || !bridge.routeAllowed) return;
        bridge.runtime = m.startRuntime(token, firstGrant.current);
        firstGrant.current = false;
      })
      .catch(() => {
        // Analytics failing to load must never affect the page.
      })
      .finally(() => {
        loading.current = false;
      });
  }, [granted, routeAllowed, token]);

  // Leaving the public layout (e.g. to /dashboard or /admin): stop at once.
  useEffect(
    () => () => {
      bridge.routeAllowed = false;
      bridge.runtime?.suspend();
    },
    [],
  );

  const choose = useCallback(
    (choice: ConsentChoice) => {
      if (serverSignal || liveSignal()) return; // the browser signal always wins
      if (choice === "denied") {
        bridge.runtime?.revoke();
        // A later re-grant must go through startRuntime (opt back in).
        bridge.runtime = null;
        bridge.granted = false;
      } else {
        firstGrant.current = true;
      }
      document.cookie = serializeConsentCookie(choice, {
        secure: process.env.NODE_ENV === "production" && window.location.protocol === "https:",
      });
      // The live gate must already be open when the Vercel mount sends its
      // first page view in the same commit.
      if (choice === "granted") bridge.granted = true;
      setStored(choice);
      setPrefsOpen(false);
    },
    [serverSignal],
  );

  const openPreferences = useCallback(() => setPrefsOpen(true), []);
  const value = useMemo(() => ({ consent, choose, openPreferences }), [consent, choose, openPreferences]);

  const showBanner = pathname === "/" && consent.state === "unknown";
  return (
    <AnalyticsContext.Provider value={value}>
      {children}
      {/* D-025: the one Vercel Web Analytics mount — consent + approved route only. */}
      {granted && routeAllowed && <VercelAnalytics />}
      {(showBanner || prefsOpen) && (
        <ConsentPanel
          mode={prefsOpen ? "preferences" : "banner"}
          consent={consent}
          onChoose={choose}
          onClose={prefsOpen ? () => setPrefsOpen(false) : undefined}
        />
      )}
    </AnalyticsContext.Provider>
  );
}
