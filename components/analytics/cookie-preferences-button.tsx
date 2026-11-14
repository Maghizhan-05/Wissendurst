"use client";

import { useAnalyticsConsent } from "./analytics-provider";

/** Footer control to reopen the consent choice. Renders nothing when analytics is not configured. */
export function CookiePreferencesButton() {
  const ctx = useAnalyticsConsent();
  if (!ctx) return null;
  return (
    <button
      type="button"
      onClick={ctx.openPreferences}
      className="rounded-sm text-xs text-muted underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      Cookie preferences
    </button>
  );
}
