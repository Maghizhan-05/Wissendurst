"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireScope, requireSuperAdmin } from "@/lib/auth";
import { eventSchema, type EventInput } from "@/lib/validation/event";
import {
  notifyApproval,
  notifyRegistrationConfirmed,
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
    parent_event_id: input.parent_event_id ? input.parent_event_id : null,
    upi_id: input.upi_id ? input.upi_id : null,
    discount_enabled: !!input.discount_enabled,
    discount_amount: Math.round((input.discount_amount_rupees ?? 0) * 100),
    team_enabled: !!input.team_enabled,
    team_min: 1, // solo allowed; the only limit is the max
    team_max: Math.max(1, input.team_max ?? 4),
    team_fee: Math.round((input.team_fee_rupees ?? 0) * 100),
  };
}

const MAX_DEPTH = 2; // root(0) -> sub(1) -> sub-sub(2): three tiers.

/**
 * Keeps the sub-event tree at most three levels deep (event → sub-event →
 * sub-sub-event) and acyclic. Returns an error message when the chosen parent
 * is invalid, or null when it's fine.
 */
async function validateParent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  parentId: string,
  selfId?: string,
): Promise<string | null> {
  if (!parentId) return null; // top-level event — nothing to check
  if (selfId && parentId === selfId)
    return "An event can't be its own broader event.";

  const { data } = await supabase
    .from("events")
    .select("id, parent_event_id, archived_at");
  const rows = (data ?? []) as {
    id: string;
    parent_event_id: string | null;
    archived_at: string | null;
  }[];
  const parentOf = new Map(rows.map((r) => [r.id, r.parent_event_id]));
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    if (r.parent_event_id) {
      const arr = childrenOf.get(r.parent_event_id) ?? [];
      arr.push(r.id);
      childrenOf.set(r.parent_event_id, arr);
    }
  }
  if (!parentOf.has(parentId)) return "That broader event no longer exists.";
  if (rows.find((r) => r.id === parentId)?.archived_at)
    return "That broader event is archived — restore it first.";

  // Depth of the chosen parent (root = 0), with a cycle guard.
  const depthOf = (id: string): number => {
    let d = 0;
    let cur = parentOf.get(id) ?? null;
    const seen = new Set<string>([id]);
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      d++;
      cur = parentOf.get(cur) ?? null;
    }
    return d;
  };
  // Height of a subtree (leaf = 0).
  const heightOf = (id: string): number => {
    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) return 0;
    return 1 + Math.max(...kids.map(heightOf));
  };

  if (selfId) {
    // The chosen parent must not sit inside this event's own subtree.
    let cur: string | null = parentId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (cur === selfId)
        return "You can't move an event under one of its own sub-events.";
      seen.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
  }

  const parentDepth = depthOf(parentId);
  if (parentDepth >= MAX_DEPTH)
    return "Sub-events go at most three levels deep (event → sub-event → sub-sub-event).";

  const selfHeight = selfId ? heightOf(selfId) : 0;
  if (parentDepth + 1 + selfHeight > MAX_DEPTH)
    return "That would make the tree more than three levels deep — move or remove this event's sub-events first.";

  return null;
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
    parent_event_id: formData.get("parent_event_id") || "",
    upi_id: formData.get("upi_id"),
    discount_enabled: formData.get("discount_enabled") === "on",
    discount_amount_rupees: formData.get("discount_amount_rupees") || 0,
    team_enabled: formData.get("team_enabled") === "on",
    team_max: formData.get("team_max") || 4,
    team_fee_rupees: formData.get("team_fee_rupees") || 0,
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
  const parentError = await validateParent(supabase, parsed.data.parent_event_id);
  if (parentError) return { ok: false, error: parentError };

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
  const parentError = await validateParent(
    supabase,
    parsed.data.parent_event_id,
    id,
  );
  if (parentError) return { ok: false, error: parentError };

  const row = rowFromInput(parsed.data);
  const { data: current } = await supabase
    .from("events")
    .select("archived_at")
    .eq("id", id)
    .maybeSingle();
  if ((current as { archived_at: string | null } | null)?.archived_at) {
    // Archived events stay closed and unfeatured until restored.
    row.registration_open = false;
    row.featured = false;
  }

  const { error } = await supabase.from("events").update(row).eq("id", id);
  if (error) {
    if (error.code === "23505")
      return { ok: false, error: "That slug is already in use." };
    return { ok: false, error: "Could not update event." };
  }
  revalidatePath("/admin/events");
  revalidatePath(`/events/${parsed.data.slug}`);
  redirect("/admin/events");
}

const EVENT_ADMIN_ERRORS: Record<string, string> = {
  FORBIDDEN: "You don't have permission to manage events.",
  EVENT_NOT_FOUND: "That event no longer exists.",
  EVENT_HAS_HISTORY:
    "This event (or one of its sub-events) has registrations or payment history, so it can't be deleted. Archive it instead.",
  PARENT_ARCHIVED: "Its broader event is archived — restore that first.",
};

function mapEventAdminError(message: string | undefined, fallback: string) {
  if (message) {
    for (const key of Object.keys(EVENT_ADMIN_ERRORS)) {
      if (message.includes(key)) return EVENT_ADMIN_ERRORS[key];
    }
  }
  return fallback;
}

function revalidateEventSurfaces() {
  revalidatePath("/admin/events");
  revalidatePath("/admin/registrations");
  revalidatePath("/admin/collections");
  revalidatePath("/events");
  revalidatePath("/events/[slug]", "page");
  revalidatePath("/schedule");
  revalidatePath("/");
  revalidatePath("/dashboard/registrations");
}

/**
 * Permanently deletes an event — only when neither it nor any sub-event has
 * registration, team or payment history (enforced by admin_delete_event and
 * ON DELETE RESTRICT in the database). Used events must be archived.
 */
export async function deleteEvent(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireScope("events");
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing event id." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_event", {
    p_event_id: id,
  });
  if (error) {
    console.error("admin_delete_event failed:", error);
    return {
      ok: false,
      error: mapEventAdminError(error.message, "Could not delete event."),
    };
  }
  revalidateEventSurfaces();
  return { ok: true, message: "Event deleted." };
}

/**
 * Archives (or restores) an event together with its sub-events. Archived
 * events are hidden publicly and closed to registration; their registration
 * and payment history stays available to admins and exports.
 */
export async function setEventArchived(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireScope("events");
  const id = String(formData.get("id") ?? "");
  const archive = formData.get("archive") === "true";
  if (!id) return { ok: false, error: "Missing event id." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_event_archived", {
    p_event_id: id,
    p_archived: archive,
  });
  if (error) {
    console.error("admin_set_event_archived failed:", error);
    return {
      ok: false,
      error: mapEventAdminError(
        error.message,
        archive ? "Could not archive event." : "Could not restore event.",
      ),
    };
  }
  revalidateEventSurfaces();
  return { ok: true, message: archive ? "Event archived." : "Event restored." };
}

export async function toggleEventFlag(formData: FormData): Promise<void> {
  await requireScope("events");
  const id = String(formData.get("id") ?? "");
  const field = String(formData.get("field") ?? "");
  const value = formData.get("value") === "true";
  if (!id || !["featured", "registration_open", "is_live"].includes(field)) return;

  const supabase = await createClient();
  // Archived events are frozen: no featuring, reopening or going live.
  await supabase
    .from("events")
    .update({ [field]: !value })
    .eq("id", id)
    .is("archived_at", null);
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
  const { data: before } = await supabase
    .from("registrations")
    .select("payment_status")
    .eq("id", registrationId)
    .maybeSingle();
  const wasVerified =
    (before as { payment_status: string } | null)?.payment_status === "verified";

  const { error } = await supabase.rpc("admin_set_payment_status", {
    p_registration_id: registrationId,
    p_status: status,
    p_note: note,
  });
  if (error) {
    console.error("admin_set_payment_status failed:", error);
    const msg = error.message ?? "";
    if (msg.includes("EVENT_FULL_AT_VERIFICATION"))
      return {
        ok: false,
        error:
          "Can't verify: this registration's seat hold has lapsed and the event is now full. Free a seat (or raise the capacity) and verify again.",
      };
    if (msg.includes("EVENT_FULL_AT_REVIEW"))
      return {
        ok: false,
        error:
          "Can't change this status: it would hold a seat again, but the event is full.",
      };
    if (msg.includes("FORBIDDEN"))
      return { ok: false, error: "You don't have permission to review payments." };
    return { ok: false, error: "Could not update payment status." };
  }

  revalidatePath("/admin/payments");
  revalidatePath(`/admin/payments/${registrationId}`);
  revalidatePath("/admin/registrations");
  revalidatePath("/admin");
  revalidatePath("/dashboard/registrations");

  // The registration confirmation goes out only now that payment is verified
  // (to every member of a team), and only once.
  if (status === "verified" && !wasVerified) {
    try {
      await notifyRegistrationConfirmed(registrationId);
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
