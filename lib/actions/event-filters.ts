"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireScope } from "@/lib/auth";
import { validateEventFilterConfig } from "@/lib/events/filter-config";

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
  const v = validateEventFilterConfig(raw);
  if (!v.ok) return { ok: false, error: v.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_event_filter_config", { p_config: v.config });
  if (error) {
    if (error.message?.includes("FORBIDDEN"))
      return { ok: false, error: "You don't have permission to manage event filters." };
    if (error.message?.includes("INVALID_FILTER_CONFIG"))
      return { ok: false, error: `The database rejected this configuration (${error.details ?? "invalid"}).` };
    return { ok: false, error: "Could not save the filters." };
  }
  revalidatePath("/events");
  revalidatePath("/admin/events/filters");
  return { ok: true, message: "Event filters saved." };
}
