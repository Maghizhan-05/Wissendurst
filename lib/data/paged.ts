import "server-only";
import { queryError } from "@/lib/supabase/query-error";

const PAGE = 1000; // PostgREST's default max rows per request

type PageResult = PromiseLike<{
  data: unknown[] | null;
  error: { message?: string; code?: string; details?: string | null; hint?: string | null } | null;
}>;

/**
 * Reads every row of a list query in fixed pages so aggregate figures are not
 * silently capped at the API's row limit. `page(from, to)` must apply a total
 * order (e.g. `.order("id")`) and `.range(from, to)`.
 */
export async function fetchAllRows<T>(
  where: string,
  /** Untyped client rows; the caller states their shape as T. */
  page: (from: number, to: number) => PageResult,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw queryError(where, error);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}
