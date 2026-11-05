/**
 * Turns a failed Supabase/PostgREST query into a thrown, logged error so it
 * reaches the error boundary instead of masquerading as "no data" or a 404.
 */
export function queryError(
  where: string,
  error: { message?: string; code?: string; details?: string | null; hint?: string | null },
): Error {
  console.error(`${where} query failed:`, {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
  return new Error(`${where} failed${error.code ? ` (${error.code})` : ""}`);
}
