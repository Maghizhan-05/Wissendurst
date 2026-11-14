"use client";

import { useEffect, useId } from "react";
import { BarChart3, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ConsentChoice, EffectiveConsent } from "@/lib/analytics/consent";
import { NO_CAPTURE_CLASS } from "@/lib/analytics/privacy";

/**
 * Consent banner (home page, first visit) and the same panel reopened from
 * the footer "Cookie preferences" control (D-024). Accept and Decline have
 * equal weight. Excluded from replay/autocapture itself.
 */
export function ConsentPanel({
  mode,
  consent,
  onChoose,
  onClose,
}: {
  mode: "banner" | "preferences";
  consent: EffectiveConsent;
  onChoose: (choice: ConsentChoice) => void;
  onClose?: () => void;
}) {
  const id = useId();
  const signal = consent.state === "denied" && consent.reason === "browser-signal";

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const status =
    consent.state === "granted"
      ? "Analytics is on."
      : consent.state === "denied"
        ? signal
          ? "Analytics is off because your browser sends a privacy signal (Global Privacy Control or Do Not Track). Turn the signal off to change this."
          : "Analytics is off."
        : null;

  return (
    <section
      role="region"
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-d`}
      className={`${NO_CAPTURE_CLASS} fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-2xl border border-border bg-surface/95 p-5 shadow-2xl backdrop-blur supports-[backdrop-filter]:bg-surface/85 sm:inset-x-6 sm:bottom-6 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))]`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/12 text-brand">
          <BarChart3 className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-t`} className="font-display text-base font-semibold text-foreground">
            {mode === "banner" ? "Help us improve Wissendurst" : "Cookie preferences"}
          </h2>
          <p id={`${id}-d`} className="mt-1.5 text-sm leading-relaxed text-muted">
            With your permission we use PostHog (EU) for anonymous analytics on our public pages:
            page views, click and scroll heatmaps, and session replays with every typed value and
            personal detail hidden. Nothing is collected on sign-in, dashboard, payment or admin
            pages, and we never link it to your account. It stays off unless you accept, and you can
            change your choice any time from &ldquo;Cookie preferences&rdquo; in the footer.
          </p>
          {mode === "preferences" && status && (
            <p role="status" className="mt-3 text-sm font-medium text-foreground">
              {status}
            </p>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cookie preferences"
            className="-mr-1 -mt-1 flex size-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {!signal && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:ml-12 sm:flex sm:justify-start">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onChoose("denied")}
            aria-pressed={mode === "preferences" ? consent.state === "denied" : undefined}
            className="sm:min-w-32"
          >
            Decline
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onChoose("granted")}
            aria-pressed={mode === "preferences" ? consent.state === "granted" : undefined}
            className="sm:min-w-32"
          >
            Accept
          </Button>
        </div>
      )}
    </section>
  );
}
