/**
 * Per-team-size pricing (0030). A team event has one price for every size
 * 1..team_max (size 1 = a person on their own); `prices[i]` is the price in
 * paise for a team of i + 1. team_min only limits who can register.
 */

export const MAX_TEAM_SIZE = 10;

/** Price (paise) for a team of `size`, or null when that size isn't priced. */
export function priceForSize(prices: readonly number[], size: number): number | null {
  if (!Number.isInteger(size) || size < 1 || size > prices.length) return null;
  return prices[size - 1] ?? null;
}

/**
 * Short public summary, e.g. "₹150 solo · teams ₹300–₹600" — or just the
 * team range when a team must have at least two people.
 */
export function teamPriceSummary(
  prices: readonly number[],
  teamMin: number,
  formatPaise: (paise: number) => string,
): string {
  if (prices.length === 0) return "";
  const range = (list: readonly number[]) => {
    const lo = Math.min(...list);
    const hi = Math.max(...list);
    return lo === hi ? formatPaise(lo) : `${formatPaise(lo)}–${formatPaise(hi)}`;
  };
  const teamPrices = prices.slice(Math.max(2, teamMin) - 1);
  if (teamMin > 1) return teamPrices.length ? `Teams ${range(teamPrices)}` : "";
  if (teamPrices.length === 0) return `${formatPaise(prices[0])} solo`;
  return `${formatPaise(prices[0])} solo · teams ${range(teamPrices)}`;
}

export type TierFieldError = { size: number; message: string };

/**
 * Validates the admin's per-size price inputs (rupees as typed). Returns the
 * prices in paise, or one error per bad size.
 */
export function parseTierRupees(
  raw: readonly string[],
  teamMax: number,
): { ok: true; prices: number[] } | { ok: false; errors: TierFieldError[] } {
  const errors: TierFieldError[] = [];
  const prices: number[] = [];
  for (let size = 1; size <= teamMax; size++) {
    const value = (raw[size - 1] ?? "").trim();
    if (value === "") {
      errors.push({ size, message: size === 1 ? "Set a price for a solo participant" : `Set a price for teams of ${size}` });
      continue;
    }
    if (!/^-?\d+(\.\d+)?$/.test(value)) {
      errors.push({ size, message: "Enter a number" });
      continue;
    }
    const n = Number(value);
    if (n < 0) errors.push({ size, message: "Can't be negative" });
    else if (!Number.isInteger(n)) errors.push({ size, message: "Whole rupees only" });
    else if (n > 1_000_000) errors.push({ size, message: "Too large" });
    else prices.push(n * 100);
  }
  return errors.length ? { ok: false, errors } : { ok: true, prices };
}
