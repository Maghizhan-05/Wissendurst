"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireScope, requireSuperAdmin } from "@/lib/auth";
import { eventSchema, type EventInput } from "@/lib/validation/event";
import {
  notifyApproval,
  notifyPaymentConfirmed,
  notifyRejection,
} from "@/lib/email/notify";
import {
  ADMIN_SCOPES,
  APPROVAL_STATUSES,
  BUCKETS,
  PAYMENT_STATUSES,
  USER_ROLES,
} from "@/lib/constants";

export type AdminActionState =
  | { ok: false; error: string }
  | { ok: true; message?: string }
  | null;

function rowFromInput(input: EventInput) {
  const rules = (input.rules ?? "")
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);

  return {
    title: input.title,
    slug: input.slug,
    category: input.category,
    short_description: input.short_description,
    description: input.description ?? "",
    eligibility: input.eligibility || null,
    venue: input.venue || null,
    registration_fee: Math.round(input.registration_fee_rupees * 100),
    event_date: input.event_date || null,
    start_time: input.start_time || null,
    end_time: input.end_time || null,
    max_participants:
      input.max_participants && input.max_participants > 0
        ? input.max_participants
        : null,
    rules,
    hero_image: input.hero_image || null,
    thumbnail_image: input.thumbnail_image || null,
    registration_open: !!input.registration_open,
    featured: !!input.featured,
    is_live: !!input.is_live,
  };
}

function parseEventForm(formData: FormData) {
  return eventSchema.safeParse({
    title: formData.get("title"),
    slug: formData.get("slug"),
    category: formData.get("category"),
    short_description: formData.get("short_description"),
    description: formData.get("description"),
    eligibility: formData.get("eligibility"),
    venue: formData.get("venue"),
    registration_fee_rupees: formData.get("registration_fee_rupees"),
    event_date: formData.get("event_date"),
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time"),
    max_participants: formData.get("max_participants") || undefined,
    rules: formData.get("rules"),
    hero_image: formData.get("hero_image"),
    thumbnail_image: formData.get("thumbnail_image"),
    registration_open: formData.get("registration_open") === "on",
    featured: formData.get("featured") === "on",
    is_live: formData.get("is_live") === "on",
  });
}

export async function createEvent(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireScope("events");
  const parsed = parseEventForm(formData);
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { ok: false, error: first ?? "Please check the form." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("events").insert(rowFromInput(parsed.data));
  if (error) {
    if (error.code === "23505")
      return { ok: false, error: "That slug is already in use." };
    return { ok: false, error: "Could not create event." };
  }
  revalidatePath("/admin/events");
  revalidatePath("/events");
  redirect("/admin/events");
}

export async function updateEvent(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireScope("events");
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing event id." };

  const parsed = parseEventForm(formData);
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { ok: false, error: first ?? "Please check the form." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("events")
    .update(rowFromInput(parsed.data))
    .eq("id", id);
  if (error) {
    if (error.code === "23505")
      return { ok: false, error: "That slug is already in use." };
    return { ok: false, error: "Could not update event." };
  }
  revalidatePath("/admin/events");
  revalidatePath(`/events/${parsed.data.slug}`);
  redirect("/admin/events");
}

export async function deleteEvent(formData: FormData): Promise<void> {
  await requireScope("events");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("events").delete().eq("id", id);
  revalidatePath("/admin/events");
  revalidatePath("/events");
}

export async function toggleEventFlag(formData: FormData): Promise<void> {
  await requireScope("events");
  const id = String(formData.get("id") ?? "");
  const field = String(formData.get("field") ?? "");
  const value = formData.get("value") === "true";
  if (!id || !["featured", "registration_open", "is_live"].includes(field)) return;

  const supabase = await createClient();
  await supabase.from("events").update({ [field]: !value }).eq("id", id);
  revalidatePath("/admin/events");
  revalidatePath("/events");
}

export async function setPaymentStatus(
  formData: FormData,
): Promise<AdminActionState> {
  await requireScope("payments");
  const registrationId = String(formData.get("registration_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!registrationId || !PAYMENT_STATUSES.includes(status as never))
    return { ok: false, error: "Invalid request." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_payment_status", {
    p_registration_id: registrationId,
    p_status: status,
    p_note: note,
  });
  if (error) return { ok: false, error: "Could not update payment status." };

  revalidatePath("/admin/payments");
  revalidatePath(`/admin/payments/${registrationId}`);
  revalidatePath("/admin/registrations");
  revalidatePath("/admin");
  revalidatePath("/dashboard/registrations");

  // Notify the participant when their payment is verified.
  if (status === "verified") {
    try {
      await notifyPaymentConfirmed(registrationId);
    } catch (e) {
      console.error("payment-confirmed email failed:", e);
    }
  }

  return { ok: true, message: "Payment status updated." };
}

/** Approve / reject a pending signup (signups scope). Emails the user. */
export async function setApproval(formData: FormData): Promise<AdminActionState> {
  await requireScope("signups");
  const userId = String(formData.get("user_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!userId || !APPROVAL_STATUSES.includes(status as never))
    return { ok: false, error: "Invalid request." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_approval", {
    p_user_id: userId,
    p_status: status,
  });
  if (error) return { ok: false, error: "Could not update approval." };

  if (status === "approved") {
    try {
      await notifyApproval(userId);
    } catch (e) {
      console.error("approval email failed:", e);
    }
  } else if (status === "rejected") {
    try {
      await notifyRejection(userId);
    } catch (e) {
      console.error("rejection email failed:", e);
    }
  }

  revalidatePath("/admin/approvals");
  revalidatePath(`/admin/approvals/${userId}`);
  revalidatePath("/admin/users");
  revalidatePath("/admin");
  return { ok: true, message: "Approval updated." };
}

/** Super admin: set a user's role, super flag and scopes. */
export async function setAdminAccess(formData: FormData): Promise<AdminActionState> {
  await requireSuperAdmin();
  const userId = String(formData.get("user_id") ?? "");
  const role = String(formData.get("role") ?? "user");
  const isSuper = formData.get("is_super_admin") != null;
  const scopes = formData
    .getAll("scopes")
    .map(String)
    .filter((s) => (ADMIN_SCOPES as readonly string[]).includes(s));
  if (!userId || !USER_ROLES.includes(role as never))
    return { ok: false, error: "Invalid request." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("super_set_admin", {
    p_user_id: userId,
    p_role: role,
    p_super: role === "admin" && isSuper,
    p_scopes: scopes,
  });
  if (error) {
    if (error.message.includes("CANNOT_DEMOTE_SELF"))
      return { ok: false, error: "You can't remove your own super-admin access." };
    return { ok: false, error: "Could not update admin access." };
  }
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
  return { ok: true, message: "Admin access updated." };
}

/** Short-lived signed URL for a private payment screenshot (payments scope). */
export async function getScreenshotSignedUrl(
  path: string,
): Promise<string | null> {
  await requireScope("payments");
  const admin = createAdminClient();
  const { data } = await admin.storage
    .from(BUCKETS.paymentScreenshots)
    .createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}

/** Short-lived signed URL for a private ID card (signups scope). */
export async function getIdCardSignedUrl(path: string): Promise<string | null> {
  await requireScope("signups");
  const admin = createAdminClient();
  const { data } = await admin.storage
    .from(BUCKETS.idCards)
    .createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}
