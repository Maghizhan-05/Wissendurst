"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireScope } from "@/lib/auth";
import { landingSchema } from "@/lib/content/landing";
import { aboutSchema } from "@/lib/content/about";
import { appearanceSchema } from "@/lib/content/appearance";

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
  column: "content" | "about" | "appearance",
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
