import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { SEED_EVENT_CATEGORIES, sanitizeCategories, type EventCategoryInfo } from "@/lib/events/categories";

/**
 * Every event category (archived included — historical events keep theirs),
 * in admin order. Public-readable. Falls back to the original seven if the
 * table can't be read so the site always renders. Cached per request.
 */
export const getEventCategories = cache(async (): Promise<EventCategoryInfo[]> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("event_categories")
      .select("id, slug, label, position, icon_key, color_key, archived_at")
      .order("position", { ascending: true });
    const rows = error ? [] : sanitizeCategories(data);
    return rows.length > 0 ? rows : SEED_EVENT_CATEGORIES;
  } catch {
    return SEED_EVENT_CATEGORIES;
  }
});
