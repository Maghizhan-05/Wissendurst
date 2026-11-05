import "server-only";
import { createClient } from "@/lib/supabase/server";
import { resolveEventFilterConfig, type EventFilterConfig } from "@/lib/events/filter-config";

/**
 * Public filter-bar configuration. Absent, unreadable or malformed data falls
 * back to the default bar (All + one tab per category).
 */
export async function getEventFilterConfig(): Promise<EventFilterConfig> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("event_filter_config")
      .select("config")
      .eq("id", 1)
      .maybeSingle();
    if (error) return resolveEventFilterConfig(null);
    return resolveEventFilterConfig(data?.config ?? null);
  } catch {
    return resolveEventFilterConfig(null);
  }
}
