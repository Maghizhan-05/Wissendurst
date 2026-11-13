"use client";

import { useState } from "react";
import { Input, Label } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import {
  PRICE_WINDOW_LABELS,
  draftsFromWindows,
  parseWindowDrafts,
  type PriceWindow,
  type PriceWindowDraft,
} from "@/lib/events/price-windows";

const HINTS = {
  early_bird: "Active between the dates below. Use a negative amount for a discount.",
  late_bird: "Active between the dates below, e.g. the last day of registration.",
  on_spot: "Active all day on the event's date (India time). Overrides early and late bird.",
} as const;

/**
 * Early bird / late bird / on spot (0032). Submits `price_windows` (JSON,
 * RPC payload). Amounts are whole rupees PER PERSON, added to the normal
 * price for every team size.
 */
export function PriceWindowsEditor({ initial }: { initial: PriceWindow[] }) {
  const [drafts, setDrafts] = useState<PriceWindowDraft[]>(() => draftsFromWindows(initial));
  const parsed = parseWindowDrafts(drafts);
  const errors = parsed.ok ? {} : parsed.errors;
  const update = (kind: string, patch: Partial<PriceWindowDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.kind === kind ? { ...d, ...patch } : d)));

  return (
    <fieldset className="rounded-xl border border-border bg-surface-2/40 p-4">
      <legend className="px-1 text-sm font-medium text-foreground">Time-based pricing</legend>
      <p className="text-sm text-muted">
        Adjust the normal price for a period. The amount is per person (a team of 3 pays it 3×) and the
        price is fixed when someone registers. Times are India time (IST). Priority: on spot, then late
        bird, then early bird.
      </p>
      <input type="hidden" name="price_windows" value={JSON.stringify(parsed.ok ? parsed.windows : null)} />
      <div className="mt-4 space-y-4">
        {drafts.map((d) => {
          const err = errors[d.kind];
          return (
            <div key={d.kind} className={cn("rounded-lg border p-3", err ? "border-alert/50" : "border-border")}>
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={d.enabled}
                  onChange={(e) => update(d.kind, { enabled: e.target.checked })}
                  className="size-4 accent-[var(--brand)]"
                />
                {PRICE_WINDOW_LABELS[d.kind]}
              </label>
              <p className="mt-1 text-xs text-muted">{HINTS[d.kind]}</p>
              {d.enabled && (
                <div className={cn("mt-3 grid gap-3", d.kind === "on_spot" ? "sm:grid-cols-1" : "sm:grid-cols-3")}>
                  {d.kind !== "on_spot" && (
                    <>
                      <div>
                        <Label htmlFor={`${d.kind}-start`}>Starts (IST)</Label>
                        <Input
                          id={`${d.kind}-start`}
                          type="datetime-local"
                          value={d.start}
                          onChange={(e) => update(d.kind, { start: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`${d.kind}-end`}>Ends (IST)</Label>
                        <Input
                          id={`${d.kind}-end`}
                          type="datetime-local"
                          value={d.end}
                          onChange={(e) => update(d.kind, { end: e.target.value })}
                        />
                      </div>
                    </>
                  )}
                  <div className={d.kind === "on_spot" ? "max-w-48" : undefined}>
                    <Label htmlFor={`${d.kind}-amount`}>₹ per person (+/−)</Label>
                    <Input
                      id={`${d.kind}-amount`}
                      inputMode="numeric"
                      placeholder={d.kind === "early_bird" ? "-50" : "1"}
                      value={d.rupees}
                      onChange={(e) => update(d.kind, { rupees: e.target.value })}
                      className="font-mono"
                    />
                  </div>
                </div>
              )}
              {err && (
                <p role="alert" className="mt-2 text-xs text-alert">
                  {err}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
