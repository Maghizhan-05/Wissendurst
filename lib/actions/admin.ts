"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireScope, requireSuperAdmin } from "@/lib/auth";
import {
  eventOffersSchema,
  eventSchema,
  type EventInput,
} from "@/lib/validation/event";
import { parseTierRupees } from "@/lib/events/team-pricing";
import {
  notifyApproval,
  notifyPaymentRejected,
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
    // Legacy discount_enabled / discount_amount columns are retired (0019)
    // in favour of Event Offers and are left untouched. The fee and team
    // settings are saved separately by admin_set_event_pricing (0030).
  };
}

type ParsedPricing =
  | {
      ok: true;
      pricing: {
        registration_fee: number;
        team_enabled: boolean;
        team_min: number;
        team_max: number;
        tiers: number[] | null;
      };
    }
  | { ok: false; error: string };

/** Fee + team pricing from the form: one price per team size 1..max. */
function parsePricing(input: EventInput, formData: FormData): ParsedPricing {
  const fee = Math.round(input.registration_fee_rupees * 100);
  const teamMax = input.team_max ?? 4;
  if (!input.team_enabled) {
    return {
      ok: true,
      pricing: { registration_fee: fee, team_enabled: false, team_min: 1, team_max: teamMax, tiers: null },
    };
  }
  const teamMin = input.team_min ?? 1;
  if (teamMin > teamMax)
    return { ok: false, error: "Min team size can't be larger than the max team size." };
  const raw = Array.from({ length: teamMax }, (_, i) => String(formData.get(`tier_${i + 1}`) ?? ""));
  const tiers = parseTierRupees(raw, teamMax);
  if (!tiers.ok) {
    const first = tiers.errors[0];
    return {
      ok: false,
      error: `Team prices: ${first.size === 1 ? "solo" : `teams of ${first.size}`} — ${first.message.toLowerCase()}.`,
    };
  }
  return {
    ok: true,
    pricing: {
      registration_fee: tiers.prices[0],
      team_enabled: true,
      team_min: teamMin,
      team_max: teamMax,
      tiers: tiers.prices,
    },
  };
}

async function savePricing(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  pricing: Extract<ParsedPricing, { ok: true }>["pricing"],
): Promise<string | null> {
  const { error } = await supabase.rpc("admin_set_event_pricing", {
    p_event_id: eventId,
    p_registration_fee: pricing.registration_fee,
    p_team_enabled: pricing.team_enabled,
    p_team_min: pricing.team_min,
    p_team_max: pricing.team_max,
    p_tiers: pricing.tiers,
  });
  if (!error) return null;
  console.error("admin_set_event_pricing failed:", error);
  if (error.message?.includes("FORBIDDEN")) return "You don't have permission to manage events.";
  if (error.message?.includes("EVENT_NOT_FOUND")) return "That event no longer exists.";
  if (error.message?.includes("INVALID_PRICING")) return "Check the fee and team prices.";
  return "Could not save the event's prices.";
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

/** Database refusals for events.category (0027 trigger / FK). */
function mapCategoryAssignmentError(message: string | undefined): string | null {
  if (!message) return null;
  if (message.includes("CATEGORY_ARCHIVED"))
    return "That category is archived. Choose an active category (events already in it keep it).";
  if (message.includes("CATEGORY_NOT_FOUND") || message.includes("events_category_fkey"))
    return "That category no longer exists. Reload the page and choose another.";
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
    team_enabled: formData.get("team_enabled") === "on",
    team_min: formData.get("team_min") || 1,
    team_max: formData.get("team_max") || 4,
  });
}

type ParsedOffers =
  | { ok: true; offers: { target_event_id: string; discount_amount: number; enabled: boolean }[] }
  | { ok: false; error: string };

/** Parses the Event Offers editor payload (JSON in the `offers` field). */
function parseOffers(formData: FormData, selfId?: string): ParsedOffers {
  let raw: unknown = [];
  try {
    raw = JSON.parse(String(formData.get("offers") ?? "[]"));
  } catch {
    return { ok: false, error: "Event offers couldn't be read. Reload and try again." };
  }
  const parsed = eventOffersSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the event offers.",
    };
  }
  if (selfId && parsed.data.some((o) => o.target_event_id === selfId)) {
    return { ok: false, error: "An event can't offer a discount on itself." };
  }
  return {
    ok: true,
    offers: parsed.data.map((o) => ({
      target_event_id: o.target_event_id,
      discount_amount: o.discount_rupees * 100,
      enabled: o.enabled,
    })),
  };
}

const OFFER_ERRORS: Record<string, string> = {
  OFFER_SELF_TARGET: "An event can't offer a discount on itself.",
  OFFER_DUPLICATE_TARGET: "Each target event can only have one offer.",
  OFFER_INVALID_AMOUNT: "Offer discounts must be whole rupees above ₹0.",
  OFFER_TARGET_NOT_FOUND: "An offer's target event no longer exists.",
  OFFER_TARGET_ARCHIVED: "An offer can't target an archived event.",
  OFFER_TARGET_NOT_REGISTRABLE:
    "Offers must target an event people register for directly (not a broader event with sub-events).",
  OFFER_INVALID: "Check the event offers.",
  FORBIDDEN: "You don't have permission to manage events.",
};

async function saveOffers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sourceId: string,
  offers: { target_event_id: string; discount_amount: number; enabled: boolean }[],
): Promise<string | null> {
  const { error } = await supabase.rpc("admin_set_event_offers", {
    p_source: sourceId,
    p_offers: offers,
  });
  if (!error) return null;
  console.error("admin_set_event_offers failed:", error);
  for (const key of Object.keys(OFFER_ERRORS)) {
    if (error.message?.includes(key)) return OFFER_ERRORS[key];
  }
  return "Could not save the event offers.";
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

  const offers = parseOffers(formData);
  if (!offers.ok) return offers;
  const pricing = parsePricing(parsed.data, formData);
  if (!pricing.ok) return pricing;

  const supabase = await createClient();
  const parentError = await validateParent(supabase, parsed.data.parent_event_id);
  if (parentError) return { ok: false, error: parentError };

  // Created as a plain event; team settings follow through the pricing RPC.
  const { data: created, error } = await supabase
    .from("events")
    .insert({ ...rowFromInput(parsed.data), registration_fee: pricing.pricing.registration_fee })
    .select("id")
    .single();
  if (error || !created) {
    if (error?.code === "23505")
      return { ok: false, error: "That slug is already in use." };
    const categoryError = mapCategoryAssignmentError(error?.message);
    if (categoryError) return { ok: false, error: categoryError };
    return { ok: false, error: "Could not create event." };
  }
  const pricingError = await savePricing(supabase, (created as { id: string }).id, pricing.pricing);
  if (pricingError) {
    revalidatePath("/admin/events");
    return {
      ok: false,
      error: `Event created, but its prices weren't saved: ${pricingError} Edit the event to set them.`,
    };
  }
  if (offers.offers.length > 0) {
    const offerError = await saveOffers(supabase, (created as { id: string }).id, offers.offers);
    if (offerError) {
      revalidatePath("/admin/events");
      return {
        ok: false,
        error: `Event created, but its offers weren't saved: ${offerError} Edit the event to add them.`,
      };
    }
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

  const offers = parseOffers(formData, id);
  if (!offers.ok) return offers;
  const pricing = parsePricing(parsed.data, formData);
  if (!pricing.ok) return pricing;

  const supabase = await createClient();
  const { data: currentRow } = await supabase
    .from("events")
    .select("archived_at, parent_event_id")
    .eq("id", id)
    .maybeSingle();
  const current = currentRow as { archived_at: string | null; parent_event_id: string | null } | null;
  if (!current) return { ok: false, error: "That event no longer exists." };
  const submittedParent = parsed.data.parent_event_id || null;

  if (current.archived_at) {
    // An archived event's place in the hierarchy is frozen (archive/restore
    // works on whole subtrees); never change it implicitly.
    if (submittedParent !== current.parent_event_id)
      return {
        ok: false,
        error: "An archived event can't be moved to a different broader event. Restore it first.",
      };
  } else {
    const parentError = await validateParent(supabase, submittedParent ?? "", id);
    if (parentError) return { ok: false, error: parentError };
  }

  const row = rowFromInput(parsed.data);
  if (current.archived_at) {
    row.parent_event_id = current.parent_event_id;
    // Archived events stay closed and unfeatured until restored.
    row.registration_open = false;
    row.featured = false;
  }

  const { error } = await supabase.from("events").update(row).eq("id", id);
  if (error) {
    if (error.code === "23505")
      return { ok: false, error: "That slug is already in use." };
    const categoryError = mapCategoryAssignmentError(error.message);
    if (categoryError) return { ok: false, error: categoryError };
    return { ok: false, error: "Could not update event." };
  }
  const pricingError = await savePricing(supabase, id, pricing.pricing);
  if (pricingError) {
    revalidatePath("/admin/events");
    return { ok: false, error: `Event saved, but its prices weren't: ${pricingError}` };
  }
  const offerError = await saveOffers(supabase, id, offers.offers);
  if (offerError) {
    revalidatePath("/admin/events");
    return { ok: false, error: `Event saved, but its offers weren't: ${offerError}` };
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
  const previous = (before as { payment_status: string } | null)?.payment_status;
  const wasVerified = previous === "verified";

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

  // A new rejection tells the payer how to submit new evidence (0031).
  if (status === "rejected" && previous !== "rejected") {
    try {
      await notifyPaymentRejected(registrationId, note);
    } catch (e) {
      console.error("payment-rejected email failed:", e);
    }
  }

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
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("PARTICIPANT_ID_SPACE_EXHAUSTED"))
      return { ok: false, error: "No IDs are left in this participant range. Nothing was changed." };
    if (msg.includes("FORBIDDEN"))
      return { ok: false, error: "You don't have permission to approve sign-ups." };
    if (msg.includes("INVALID_APPROVAL_TRANSITION"))
      return {
        ok: false,
        error: "Only pending applications can be approved or rejected. Reload to see the current status.",
      };
    return { ok: false, error: "Could not update approval." };
  }

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
    if (error.message.includes("PARTICIPANT_ID_SPACE_EXHAUSTED"))
      return {
        ok: false,
        error: "No staff IDs are left in that range (admin/99 or supadmin/99 reached). Nothing was changed.",
      };
    return { ok: false, error: "Could not update admin access." };
  }
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
  revalidatePath("/", "layout"); // the participant ID shown in navigation changed
  return { ok: true, message: "Admin access and participant ID updated." };
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
