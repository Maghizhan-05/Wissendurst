"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireScope } from "@/lib/auth";
import type { AdminActionState } from "@/lib/actions/admin";
import { categoryStyleSchema, linksToCategory, newCategorySchema } from "@/lib/events/categories";
import { getAboutContent, getLandingContent } from "@/lib/data/settings";

const ERRORS: Record<string, string> = {
  FORBIDDEN: "You don't have permission to manage event categories.",
  INVALID_CATEGORY_SLUG: "The slug may use lowercase letters, digits and single hyphens (and can't be “all”).",
  CATEGORY_SLUG_TAKEN: "Another category already uses that slug.",
  CATEGORY_LABEL_TAKEN: "Another category already has that name.",
  CATEGORY_SLUG_USED_BY_FILTER_TAB:
    "A filter tab already uses that slug, so the category's link would open the tab instead. Choose another slug.",
  INVALID_CATEGORY_LABEL: "Use a name of 1–40 characters without leading or trailing spaces.",
  INVALID_CATEGORY_ICON: "Choose an icon from the list.",
  INVALID_CATEGORY_COLOR: "Choose a tint from the list.",
  TOO_MANY_CATEGORIES: "There can be at most 50 categories. Delete an unused one first.",
  CATEGORY_NOT_FOUND: "That category no longer exists. Reload the page.",
  CATEGORY_PROTECTED: "“Other” is the fallback category, so it can't be archived or deleted.",
  INVALID_CATEGORY_ORDER: "The category list changed meanwhile. Reload and try again.",
};
const IN_USE: Record<string, string> = {
  EVENTS: "Events use this category (archived events count too), so it can only be archived.",
  FILTER_GROUPS: "A filter tab still includes this category. Remove it from the filter tabs first.",
  HOMEPAGE_LINKS: "The homepage links to this category. Change that link in Site content first.",
};

function mapError(error: { message?: string; details?: string | null } | null, fallback: string): string {
  const m = error?.message ?? "";
  if (m.includes("CATEGORY_IN_USE")) return IN_USE[error?.details ?? ""] ?? "This category is still in use.";
  for (const key of Object.keys(ERRORS)) if (m.includes(key)) return ERRORS[key];
  return fallback;
}

function revalidateAll() {
  // Category labels/visuals appear on every page (root-layout provider).
  revalidatePath("/", "layout");
}

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Please check the form.";

export async function createEventCategory(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  await requireScope("events");
  const parsed = newCategorySchema.safeParse({
    slug: String(formData.get("slug") ?? "").trim(),
    label: String(formData.get("label") ?? "").trim(),
    icon_key: formData.get("icon_key"),
    color_key: formData.get("color_key"),
  });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_create_event_category", {
    p_slug: parsed.data.slug,
    p_label: parsed.data.label,
    p_icon_key: parsed.data.icon_key,
    p_color_key: parsed.data.color_key,
  });
  if (error) return { ok: false, error: mapError(error, "Could not create the category.") };
  revalidateAll();
  return { ok: true, message: `Category “${parsed.data.label}” created.` };
}

export async function updateEventCategory(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  await requireScope("events");
  const id = String(formData.get("id") ?? "");
  const parsed = categoryStyleSchema.safeParse({
    label: String(formData.get("label") ?? "").trim(),
    icon_key: formData.get("icon_key"),
    color_key: formData.get("color_key"),
  });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_event_category", {
    p_id: id,
    p_label: parsed.data.label,
    p_icon_key: parsed.data.icon_key,
    p_color_key: parsed.data.color_key,
  });
  if (error) return { ok: false, error: mapError(error, "Could not save the category.") };
  revalidateAll();
  return { ok: true, message: "Category saved." };
}

export async function reorderEventCategories(ids: string[]): Promise<AdminActionState> {
  await requireScope("events");
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string"))
    return { ok: false, error: ERRORS.INVALID_CATEGORY_ORDER };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reorder_event_categories", { p_ids: ids });
  if (error) return { ok: false, error: mapError(error, "Could not reorder the categories.") };
  revalidateAll();
  return { ok: true, message: "Order saved." };
}

export async function setEventCategoryArchived(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  await requireScope("events");
  const archived = formData.get("archived") === "true";
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_event_category_archived", {
    p_id: String(formData.get("id") ?? ""),
    p_archived: archived,
  });
  if (error) return { ok: false, error: mapError(error, "Could not update the category.") };
  revalidateAll();
  return { ok: true, message: archived ? "Category archived." : "Category restored." };
}

export async function deleteEventCategory(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  await requireScope("events");
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const { data: row } = await supabase.from("event_categories").select("slug").eq("id", id).maybeSingle();
  const slug = (row as { slug: string } | null)?.slug;
  if (!slug) return { ok: false, error: ERRORS.CATEGORY_NOT_FOUND };
  // The database checks the stored site content; this also covers built-in
  // homepage defaults that are shown while nothing is stored.
  const [landing, about] = await Promise.all([getLandingContent(), getAboutContent()]);
  if (linksToCategory(landing, slug) || linksToCategory(about, slug)) return { ok: false, error: IN_USE.HOMEPAGE_LINKS };
  const { error } = await supabase.rpc("admin_delete_event_category", { p_id: id });
  if (error) return { ok: false, error: mapError(error, "Could not delete the category.") };
  revalidateAll();
  return { ok: true, message: "Category deleted." };
}
