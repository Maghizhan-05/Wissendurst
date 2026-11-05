import { BUCKETS } from "./constants.ts";

/**
 * Public URL for a stored profile photo path ("<uid>/<file>"), always on the
 * configured Supabase origin. Returns null for anything that isn't a plain
 * object path (old/foreign values are never rendered as image sources).
 */
export function profilePhotoUrl(path: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base || !path || !/^[0-9a-f-]{36}\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(path) || path.includes("..")) return null;
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKETS.profileImages}/${path}`;
}
