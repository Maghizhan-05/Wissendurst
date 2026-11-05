import "server-only";
import { createClient } from "@/lib/supabase/server";
import { resolveEventFilterConfig, type EventFilterConfig } from "@/lib/events/filter-config";
import { getEventCategories } from "@/lib/data/event-categories";

/** Raw stored configuration (null if absent or unreadable). */
export async function getStoredEventFilterConfig(): Promise<unknown> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("event_filter_config")
      .select("config")
      .eq("id", 1)
      .maybeSingle();
    return error ? null : (data?.config ?? null);
  } catch {
    return null;
  }
}

/**
 * Public filter-bar configuration. Absent, unreadable or malformed data falls
 * back to the default bar (All + one tab per active category).
 */
export async function getEventFilterConfig(): Promise<EventFilterConfig> {
  const [raw, categories] = await Promise.all([getStoredEventFilterConfig(), getEventCategories()]);
  return resolveEventFilterConfig(raw, categories);
}
