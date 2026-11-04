/**
 * Merge-over-default helpers for stored CMS JSON. Every stored field is
 * validated on read with the same schema used on save; anything missing or
 * invalid falls back to the built-in default, so old or partial JSON (and
 * hand-edited rows) can never break a page.
 */
import type { z } from "zod";

type Shape = Record<string, z.ZodType>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Field-by-field merge of `stored` over `defaults` using `shape` validators. */
export function mergeFields<T extends Record<string, unknown>>(
  shape: Shape,
  defaults: T,
  stored: unknown,
): T {
  if (!isRecord(stored)) return defaults;
  const out: Record<string, unknown> = { ...defaults };
  for (const key of Object.keys(shape)) {
    if (!(key in stored) || stored[key] === undefined) continue;
    const parsed = shape[key].safeParse(stored[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as T;
}

/**
 * Validates a stored list item-by-item, keeping valid items in order and
 * dropping invalid ones. `emptyMeansDefault` keeps the legacy behaviour of
 * lists that fall back to defaults when nothing (valid) is stored.
 */
export function mergeList<T>(
  item: z.ZodType<T>,
  defaults: T[],
  stored: unknown,
  { max, emptyMeansDefault }: { max: number; emptyMeansDefault: boolean },
): T[] {
  if (!Array.isArray(stored)) return defaults;
  const valid: T[] = [];
  for (const raw of stored) {
    const parsed = item.safeParse(raw);
    if (parsed.success) valid.push(parsed.data);
    if (valid.length >= max) break;
  }
  if (valid.length === 0 && emptyMeansDefault) return defaults;
  return valid;
}
