"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireScope } from "@/lib/auth";
import { landingSchema } from "@/lib/content/landing";
import { aboutSchema } from "@/lib/content/about";
import { appearanceSchema } from "@/lib/content/appearance";
import { socialSchema } from "@/lib/content/social";
import { scheduleSchema } from "@/lib/content/schedule";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  BACKGROUND_MAX_BYTES,
  BACKGROUND_TYPES,
  backgroundsSchema,
  sniffImageType,
} from "@/lib/content/backgrounds";

export type ContentState =
  | { ok: false; error: string }
  | { ok: true; message: string }
  | null;

function readJson(formData: FormData, field: string): unknown {
  try {
    return JSON.parse(String(formData.get(field) ?? ""));
  } catch {
    return undefined;
  }
}

/** First validation problem as a readable message ("categories › boxes › 2 › href: …"). */
function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Some fields are invalid.";
  const where = issue.path
    .map((p) => (typeof p === "number" ? `#${p + 1}` : String(p)))
    .join(" › ");
  return where ? `${where}: ${issue.message}` : issue.message;
}

async function saveColumn(
  column: "content" | "about" | "appearance" | "social" | "schedule" | "backgrounds",
  value: unknown,
): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("site_settings")
    .upsert({ id: 1, [column]: value }, { onConflict: "id" });
  if (error) {
    console.error(`site_settings ${column} save failed:`, error);
    return "Could not save changes.";
  }
  return null;
}

export async function updateLandingContent(
  _prev: ContentState,
  formData: FormData,
): Promise<ContentState> {
  await requireScope("content");
  const raw = readJson(formData, "content");
  if (raw === undefined) return { ok: false, error: "Could not read the form data." };

  const result = landingSchema.safeParse(raw);
  if (!result.success) return { ok: false, error: firstIssue(result.error) };

  const err = await saveColumn("content", result.data);
  if (err) return { ok: false, error: err };

  // The footer is part of every public page.
  revalidatePath("/", "layout");
  return { ok: true, message: "Home page updated." };
}

export async function updateAboutContent(
  _prev: ContentState,
  formData: FormData,
): Promise<ContentState> {
  await requireScope("content");
  const raw = readJson(formData, "about");
  if (raw === undefined) return { ok: false, error: "Could not read the form data." };

  const result = aboutSchema.safeParse(raw);
  if (!result.success) return { ok: false, error: firstIssue(result.error) };

  const err = await saveColumn("about", result.data);
  if (err) return { ok: false, error: err };

  revalidatePath("/about");
  revalidatePath("/admin/content/about");
  return { ok: true, message: "About page updated." };
}

export async function updateAppearance(
  _prev: ContentState,
  formData: FormData,
): Promise<ContentState> {
  await requireScope("content");
  const raw = readJson(formData, "appearance");
  if (raw === undefined) return { ok: false, error: "Could not read the form data." };

  const result = appearanceSchema.safeParse(raw);
  if (!result.success) return { ok: false, error: firstIssue(result.error) };

  const err = await saveColumn("appearance", result.data);
  if (err) return { ok: false, error: err };

  // Colours apply to every page (public, participant and admin).
  revalidatePath("/", "layout");
  return { ok: true, message: "Appearance updated." };
}

export type BackgroundUploadResult = { ok: true; path: string } | { ok: false; error: string };

/**
 * Uploads a background image (0033) to the public `site-images` bucket. Type
 * is checked by the declared MIME type AND the file's leading bytes; the
 * bucket itself also enforces 5 MB and PNG/JPEG/WebP. Nothing is applied to
 * the site until the appearance form is saved.
 */
export async function uploadBackgroundImage(formData: FormData): Promise<BackgroundUploadResult> {
  await requireScope("content");
  const mode = String(formData.get("mode") ?? "");
  const file = formData.get("file");
  if (mode !== "light" && mode !== "dark") return { ok: false, error: "Choose light or dark." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an image to upload." };
  if (!BACKGROUND_TYPES.includes(file.type as never)) return { ok: false, error: "Upload a PNG, JPG or WebP image." };
  if (file.size > BACKGROUND_MAX_BYTES) return { ok: false, error: "Image is too large (max 5 MB)." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImageType(bytes);
  if (!sniffed || sniffed !== file.type) return { ok: false, error: "That file isn't a valid PNG, JPG or WebP image." };

  const ext = sniffed === "image/png" ? "png" : sniffed === "image/jpeg" ? "jpg" : "webp";
  const path = `backgrounds/${mode}-${randomUUID()}.${ext}`;
  const { error } = await createAdminClient()
    .storage.from("site-images")
    .upload(path, bytes, { contentType: sniffed, cacheControl: "31536000", upsert: false });
  if (error) {
    console.error("background upload failed:", error);
    return { ok: false, error: "Could not upload the image. Please try again." };
  }
  return { ok: true, path };
}

export async function updateBackgrounds(
  _prev: ContentState,
  formData: FormData,
): Promise<ContentState> {
  await requireScope("content");
  const raw = readJson(formData, "backgrounds");
  if (raw === undefined) return { ok: false, error: "Could not read the form data." };
  const result = backgroundsSchema.safeParse(raw);
  if (!result.success) return { ok: false, error: firstIssue(result.error) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("site_settings")
    .upsert({ id: 1, backgrounds: result.data }, { onConflict: "id" });
  if (error) {
    console.error("site_settings backgrounds save failed:", error);
    if (error.message?.includes("BACKGROUND_IMAGE_NOT_FOUND")) {
      return { ok: false, error: "An image is missing — upload it again." };
    }
    return { ok: false, error: "Could not save changes." };
  }

  // Remove images that are no longer used (older than an hour, so another
  // admin's just-uploaded, not-yet-saved image is never removed).
  try {
    const admin = createAdminClient();
    const { data: files } = await admin.storage.from("site-images").list("backgrounds", { limit: 1000 });
    const keep = new Set([result.data.light, result.data.dark].filter(Boolean));
    const cutoff = Date.now() - 60 * 60 * 1000;
    const stale = (files ?? [])
      .filter((f) => f.id && !keep.has(`backgrounds/${f.name}`) && Date.parse(f.created_at ?? "") < cutoff)
      .map((f) => `backgrounds/${f.name}`);
    if (stale.length) await admin.storage.from("site-images").remove(stale);
  } catch (e) {
    console.error("background cleanup failed:", e);
  }

  revalidatePath("/", "layout");
  return { ok: true, message: "Background updated." };
}

export async function updateSocialLinks(
  _prev: ContentState,
  formData: FormData,
): Promise<ContentState> {
  await requireScope("content");
  const raw = readJson(formData, "social");
  if (raw === undefined) return { ok: false, error: "Could not read the form data." };

  const result = socialSchema.safeParse(raw);
  if (!result.success) return { ok: false, error: firstIssue(result.error) };

  const err = await saveColumn("social", result.data);
  if (err) return { ok: false, error: err };

  // The menu is in the public navbar on every page.
  revalidatePath("/", "layout");
  return { ok: true, message: "Social links updated." };
}

export async function updateScheduleContent(
  _prev: ContentState,
  formData: FormData,
): Promise<ContentState> {
  await requireScope("content");
  const raw = readJson(formData, "schedule");
  if (raw === undefined) return { ok: false, error: "Could not read the form data." };

  const result = scheduleSchema.safeParse(raw);
  if (!result.success) return { ok: false, error: firstIssue(result.error) };

  const err = await saveColumn("schedule", result.data);
  if (err) return { ok: false, error: err };

  revalidatePath("/schedule");
  revalidatePath("/admin/content/schedule");
  return { ok: true, message: "Schedule page updated." };
}
