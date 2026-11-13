/**
 * Early bird / late bird / on spot (0032). Adjustments are signed whole
 * rupees PER PERSON, added to the normal price (× team size, never below ₹0).
 * Admin dates are entered and shown in India time (Asia/Kolkata, UTC+05:30).
 */

export type PriceWindowKind = "early_bird" | "late_bird" | "on_spot";

export const PRICE_WINDOW_LABELS: Record<PriceWindowKind, string> = {
  early_bird: "Early bird",
  late_bird: "Late bird",
  on_spot: "On spot",
};

export type PriceWindow = {
  kind: PriceWindowKind;
  starts_at: string | null; // ISO
  ends_at: string | null; // ISO
  adjustment: number; // paise, per person
};

export type PriceWindowDraft = {
  kind: PriceWindowKind;
  enabled: boolean;
  start: string; // datetime-local, IST ("2026-11-07T10:00")
  end: string;
  rupees: string; // signed whole rupees per person
};

const IST_OFFSET_MIN = 330;

/** ISO instant → "YYYY-MM-DDTHH:mm" in India time (for datetime-local). */
export function toIstLocal(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 16);
}

/** "YYYY-MM-DDTHH:mm" in India time → ISO with +05:30, or null if invalid. */
export function fromIstLocal(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const t = Date.parse(`${local}:00+05:30`);
  return Number.isNaN(t) ? null : `${local}:00+05:30`;
}

export function draftsFromWindows(windows: readonly PriceWindow[]): PriceWindowDraft[] {
  return (["early_bird", "late_bird", "on_spot"] as const).map((kind) => {
    const w = windows.find((x) => x.kind === kind);
    return {
      kind,
      enabled: Boolean(w),
      start: toIstLocal(w?.starts_at ?? null),
      end: toIstLocal(w?.ends_at ?? null),
      rupees: w ? String(w.adjustment / 100) : "",
    };
  });
}

export type WindowErrors = Partial<Record<PriceWindowKind, string>>;

/** Validates the editor drafts; returns the RPC payload or per-kind errors. */
export function parseWindowDrafts(
  drafts: readonly PriceWindowDraft[],
): { ok: true; windows: PriceWindow[] } | { ok: false; errors: WindowErrors } {
  const errors: WindowErrors = {};
  const windows: PriceWindow[] = [];
  for (const d of drafts) {
    if (!d.enabled) continue;
    const label = PRICE_WINDOW_LABELS[d.kind];
    const r = d.rupees.trim();
    if (!/^[+-]?\d+$/.test(r)) {
      errors[d.kind] = `${label}: enter a whole-rupee amount per person (negative for a discount).`;
      continue;
    }
    const rupees = Number(r);
    if (Math.abs(rupees) > 1_000_000) {
      errors[d.kind] = `${label}: amount is too large.`;
      continue;
    }
    if (d.kind === "on_spot") {
      windows.push({ kind: d.kind, starts_at: null, ends_at: null, adjustment: rupees * 100 });
      continue;
    }
    const s = fromIstLocal(d.start);
    const e = fromIstLocal(d.end);
    if (!s || !e) {
      errors[d.kind] = `${label}: set both a start and an end date and time.`;
      continue;
    }
    if (Date.parse(s) >= Date.parse(e)) {
      errors[d.kind] = `${label}: the end must be after the start.`;
      continue;
    }
    windows.push({ kind: d.kind, starts_at: s, ends_at: e, adjustment: rupees * 100 });
  }
  const early = windows.find((w) => w.kind === "early_bird");
  const late = windows.find((w) => w.kind === "late_bird");
  if (
    early && late &&
    Date.parse(early.starts_at!) < Date.parse(late.ends_at!) &&
    Date.parse(late.starts_at!) < Date.parse(early.ends_at!)
  ) {
    errors.late_bird = "Early bird and late bird can't overlap.";
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, windows };
}

/** Same arithmetic as event_offer_price: never below ₹0. */
export function adjustedPrice(normal: number, adjustmentPerPerson: number, size: number): number {
  return Math.max(normal + adjustmentPerPerson * Math.max(1, size), 0);
}
