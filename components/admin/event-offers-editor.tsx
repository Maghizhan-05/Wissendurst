"use client";

import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { cn, formatINR } from "@/lib/utils";
import type { OfferTargetOption } from "@/lib/data/admin";

export interface OfferDraft {
  target_event_id: string;
  /** Whole rupees as typed (validated on the server too). */
  discount_rupees: string;
  enabled: boolean;
}

type Row = OfferDraft & { key: number };

let nextKey = 1;

/**
 * Event Offers editor. Each row says: a participant whose payment for THIS
 * event is verified gets ₹X off the chosen target event. Serialised into the
 * hidden `offers` field; the server re-validates everything.
 */
export function EventOffersEditor({
  initialOffers,
  targets,
}: {
  initialOffers: OfferDraft[];
  targets: OfferTargetOption[];
}) {
  const baseId = useId();
  const [rows, setRows] = useState<Row[]>(() =>
    initialOffers.map((o) => ({ ...o, key: nextKey++ })),
  );
  const byId = new Map(targets.map((t) => [t.id, t]));
  const initialTargets = new Set(initialOffers.map((o) => o.target_event_id));

  const update = (key: number, patch: Partial<OfferDraft>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  const add = () =>
    setRows((rs) => [
      ...rs,
      { key: nextKey++, target_event_id: "", discount_rupees: "", enabled: true },
    ]);

  const errorFor = (row: Row): string | null => {
    if (!row.target_event_id) return "Pick a target event.";
    if (rows.filter((r) => r.target_event_id === row.target_event_id).length > 1)
      return "This target already has an offer.";
    const n = Number(row.discount_rupees);
    if (!row.discount_rupees || !Number.isInteger(n) || n < 1)
      return "Enter a whole-rupee discount of at least ₹1.";
    return null;
  };

  const payload = JSON.stringify(
    rows.map((r) => ({
      target_event_id: r.target_event_id,
      discount_rupees: r.discount_rupees === "" ? null : Number(r.discount_rupees),
      enabled: r.enabled,
    })),
  );

  return (
    <fieldset className="rounded-xl border border-border bg-surface-2/40 p-4">
      <legend className="px-1 text-sm font-medium text-foreground">Event offers</legend>
      <p className="text-xs text-muted">
        When a participant&rsquo;s payment for <strong>this event</strong> is
        verified, they get the discount below on each chosen event. Offers work
        in one direction only. If several offers apply to the same event, the
        participant gets the single highest one, never more than that
        event&rsquo;s price. Prices already reserved don&rsquo;t change.
      </p>
      <input type="hidden" name="offers" value={payload} />

      {rows.length > 0 && (
        <ul className="mt-4 space-y-3">
          {rows.map((row, i) => {
            const error = errorFor(row);
            const target = byId.get(row.target_event_id);
            const n = Number(row.discount_rupees);
            const targetPrice = target ? target.registration_fee / 100 : null;
            const capped = targetPrice != null && Number.isFinite(n) && n > targetPrice;
            const id = `${baseId}-${row.key}`;
            return (
              <li
                key={row.key}
                className="grid gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-[1fr_9rem_auto_auto] sm:items-end"
              >
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-target`} className="text-xs font-medium text-muted">
                    Offer {i + 1}: discount on
                  </label>
                  <Select
                    id={`${id}-target`}
                    value={row.target_event_id}
                    onChange={(e) => update(row.key, { target_event_id: e.target.value })}
                    aria-invalid={Boolean(error) || undefined}
                    aria-describedby={error ? `${id}-error` : undefined}
                  >
                    <option value="">Choose an event…</option>
                    {targets.map((t) => {
                      const takenElsewhere = rows.some(
                        (r) => r.key !== row.key && r.target_event_id === t.id,
                      );
                      // Unavailable targets appear only for an offer that already exists.
                      if (t.unavailable && !(initialTargets.has(t.id) && row.target_event_id === t.id))
                        return null;
                      return (
                        <option key={t.id} value={t.id} disabled={takenElsewhere}>
                          {t.title} — {t.registration_fee === 0 ? "Free" : formatINR(t.registration_fee)}
                          {t.team_enabled ? ` (team ${formatINR(t.team_fee)})` : ""}
                          {t.unavailable ? " — archived/unavailable" : ""}
                        </option>
                      );
                    })}
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-amount`} className="text-xs font-medium text-muted">
                    Discount (₹)
                  </label>
                  <Input
                    id={`${id}-amount`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={row.discount_rupees}
                    onChange={(e) => update(row.key, { discount_rupees: e.target.value })}
                    aria-invalid={Boolean(error) || undefined}
                  />
                </div>
                <label className="flex h-11 items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(e) => update(row.key, { enabled: e.target.checked })}
                    className="size-4 accent-[var(--brand)]"
                  />
                  Enabled
                </label>
                <button
                  type="button"
                  onClick={() => remove(row.key)}
                  aria-label={`Remove offer ${i + 1}`}
                  title="Remove offer"
                  className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:bg-alert/10 hover:text-alert focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
                {(error || capped) && (
                  <p
                    id={`${id}-error`}
                    className={cn("text-xs sm:col-span-4", error ? "text-alert" : "text-muted")}
                    role={error ? "alert" : undefined}
                  >
                    {error ??
                      `Capped at the event's price (${formatINR(target!.registration_fee)}) for solo registration.`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={add}>
        <Plus className="size-4" aria-hidden /> Add offer
      </Button>
    </fieldset>
  );
}
