"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireScope } from "@/lib/auth";
import { validateEventFilterConfig, type EventFilterConfig } from "@/lib/events/filter-config";
import { getEventCategories } from "@/lib/data/event-categories";
import { getStoredEventFilterConfig } from "@/lib/data/event-filters";

export type FilterSaveState = { ok: false; error: string } | { ok: true; message: string } | null;

/** Saves the filter bar (events scope). Validated here and again in PostgreSQL. */
export async function saveEventFilterConfig(
  _prev: FilterSaveState,
  formData: FormData,
): Promise<FilterSaveState> {
  await requireScope("events");
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("config") ?? ""));
  } catch {
    return { ok: false, error: "The filter configuration couldn't be read." };
  }
  const [categories, storedRaw] = await Promise.all([getEventCategories(), getStoredEventFilterConfig()]);
  const stored = validateEventFilterConfig(storedRaw);
  const v = validateEventFilterConfig(raw, {
    categories,
    previous: stored.ok ? (stored.config as EventFilterConfig) : null,
  });
  if (!v.ok) return { ok: false, error: v.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_event_filter_config", { p_config: v.config });
  if (error) {
    if (error.message?.includes("FORBIDDEN"))
      return { ok: false, error: "You don't have permission to manage event filters." };
    if (error.message?.includes("INVALID_FILTER_CONFIG")) {
      if (error.details === "ARCHIVED_CATEGORY")
        return { ok: false, error: "An archived category can't be added to a group. Restore it first." };
      if (error.details === "UNKNOWN_CATEGORY")
        return { ok: false, error: "A category in this configuration no longer exists. Reload and try again." };
      return { ok: false, error: `The database rejected this configuration (${error.details ?? "invalid"}).` };
    }
    return { ok: false, error: "Could not save the filters." };
  }
  revalidatePath("/events");
  revalidatePath("/admin/events/filters");
  return { ok: true, message: "Event filters saved." };
}
