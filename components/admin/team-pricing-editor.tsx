"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Field, Input, Label } from "@/components/ui/field";
import { cn, formatINR } from "@/lib/utils";
import { MAX_TEAM_SIZE, parseTierRupees, teamPriceSummary } from "@/lib/events/team-pricing";

/**
 * Team registration settings on the event form (0030): min/max team size and
 * one price for every size 1..max. Inputs are named `team_enabled`,
 * `team_min`, `team_max` and `tier_1`..`tier_N` (rupees).
 */
export function TeamPricingEditor({
  enabled: initialEnabled,
  teamMin: initialMin,
  teamMax: initialMax,
  prices,
  soloFeeRupees,
}: {
  enabled: boolean;
  teamMin: number;
  teamMax: number;
  /** Saved prices in paise, index 0 = size 1. */
  prices: number[];
  /** Current value of the registration fee field (pre-fills size 1). */
  soloFeeRupees: string;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [minRaw, setMinRaw] = useState(String(initialMin));
  const [maxRaw, setMaxRaw] = useState(String(initialMax));
  const [values, setValues] = useState<string[]>(() =>
    Array.from({ length: MAX_TEAM_SIZE }, (_, i) =>
      prices[i] !== undefined ? String(prices[i] / 100) : i === 0 ? soloFeeRupees : "",
    ),
  );
  const [touched, setTouched] = useState(false);

  const max = clampSize(maxRaw, initialMax);
  const min = Math.min(clampSize(minRaw, 1), max);
  const sizes = Array.from({ length: max }, (_, i) => i + 1);
  const parsed = parseTierRupees(values, max);
  const errors = new Map(parsed.ok ? [] : parsed.errors.map((e) => [e.size, e.message]));
  const savedMax = initialEnabled ? initialMax : 0;
  const dropped = savedMax > max ? `${max + 1}${savedMax > max + 1 ? `–${savedMax}` : ""}` : null;
  const newSizes = savedMax > 0 && max > savedMax && sizes.slice(savedMax).some((n) => errors.has(n));

  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="team_enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-1 size-4 accent-[var(--brand)]"
        />
        <span>
          <span className="block text-sm font-medium text-foreground">Team registration</span>
          <span className="block text-sm text-muted">
            The team head adds teammates by participant ID (W27/E/…) and pays once for the whole team.
            Set a price for every team size — size 1 is what a person registering alone pays. Nobody can
            be on more than one team per event.
          </span>
        </span>
      </label>

      {enabled && (
        <div className="mt-4 space-y-4">
          <div className="grid max-w-md gap-4 sm:grid-cols-2">
            <Field label="Min team size" htmlFor="team_min" hint="Smallest team that can register">
              <Input
                id="team_min"
                name="team_min"
                type="number"
                min={1}
                max={max}
                value={minRaw}
                onChange={(e) => setMinRaw(e.target.value)}
              />
            </Field>
            <Field
              label="Max team size"
              htmlFor="team_max"
              hint={
                dropped
                  ? `Prices for teams of ${dropped} will be removed when you save`
                  : `Head included. Up to ${MAX_TEAM_SIZE} (one price per size)`
              }
            >
              <Input
                id="team_max"
                name="team_max"
                type="number"
                min={1}
                max={MAX_TEAM_SIZE}
                value={maxRaw}
                onChange={(e) => setMaxRaw(e.target.value)}
              />
            </Field>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-foreground">
              Price by team size <span className="text-alert">*</span>
            </legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {sizes.map((n) => {
                const err = touched || values[n - 1] !== "" ? errors.get(n) : undefined;
                return (
                  <div key={n}>
                    <Label htmlFor={`tier_${n}`}>
                      {n === 1 ? "Solo (1)" : `${n} people`}
                      {n < min && <span className="ml-1 text-xs text-muted">(below min)</span>}
                    </Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">
                        ₹
                      </span>
                      <Input
                        id={`tier_${n}`}
                        name={`tier_${n}`}
                        inputMode="numeric"
                        value={values[n - 1]}
                        onChange={(e) =>
                          setValues((v) => v.map((x, i) => (i === n - 1 ? e.target.value : x)))
                        }
                        onBlur={() => setTouched(true)}
                        aria-invalid={err ? true : undefined}
                        aria-describedby={err ? `tier_${n}-err` : undefined}
                        className={cn("pl-7 font-mono", err && "border-alert focus-visible:outline-alert")}
                      />
                    </div>
                    {err && (
                      <p id={`tier_${n}-err`} className="mt-1 text-xs text-alert">
                        {err}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {parsed.ok && (
              <p className="mt-2 text-xs text-muted">
                Shown publicly as{" "}
                <span className="font-medium text-foreground">
                  {teamPriceSummary(parsed.prices, min, formatINR)}
                </span>
                . A team&rsquo;s price is fixed when it registers; changing these later doesn&rsquo;t
                change teams that already registered. The solo price is also the event&rsquo;s
                registration fee.
              </p>
            )}
            {newSizes && (
              <p
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-lg border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>You raised the max team size to {max} — add prices for the new sizes before saving.</span>
              </p>
            )}
          </fieldset>
        </div>
      )}
    </div>
  );
}

function clampSize(raw: string, fallback: number) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return Math.max(1, Math.min(fallback, MAX_TEAM_SIZE));
  return Math.min(n, MAX_TEAM_SIZE);
}
