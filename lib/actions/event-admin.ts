"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireEventArea, requireSuperAdmin } from "@/lib/auth";
import { eventSchema } from "@/lib/validation/event";
import { parseRulesText, rulesError } from "@/lib/events/rules";
import { parseWhatsAppGroupUrl } from "@/lib/email/whatsapp";
import { EVENT_PERMISSIONS } from "@/lib/constants";
import type { AdminActionState } from "@/lib/actions/admin";

/* Per-event administration (0034). The database re-checks every permission
 * (has_event_permission); these actions only shape input and messages. */

const uuid = z.string().uuid();

const ASSIGNMENT_ERRORS: Record<string, string> = {
  FORBIDDEN: "Only the super admin can change event administrators.",
  INVALID_EVENT_PERMISSION: "Choose valid event permissions.",
  USER_NOT_FOUND: "That account no longer exists.",
  USER_NOT_APPROVED: "Only approved accounts can administer an event.",
  EVENT_NOT_FOUND: "That event no longer exists.",
  EVENT_IS_BROADER:
    "Assign the sub-event people register for, not a broader event with sub-events.",
};

/** Super admin: set or remove one account's permissions on one event. */
export async function setEventAdminAccess(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireSuperAdmin();
  const userId = String(formData.get("user_id") ?? "");
  const eventId = String(formData.get("event_id") ?? "");
  const permissions = formData
    .getAll("permissions")
    .map(String)
    .filter((p) => (EVENT_PERMISSIONS as readonly string[]).includes(p));
  if (!uuid.safeParse(userId).success || !uuid.safeParse(eventId).success)
    return { ok: false, error: "Choose an event." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("super_set_event_admin", {
    p_user_id: userId,
    p_event_id: eventId,
    p_permissions: permissions,
  });
  if (error) {
    console.error("super_set_event_admin failed:", error);
    for (const key of Object.keys(ASSIGNMENT_ERRORS)) {
      if (error.message?.includes(key)) return { ok: false, error: ASSIGNMENT_ERRORS[key] };
    }
    return { ok: false, error: "Could not update event administration." };
  }
  revalidatePath(`/admin/users/${userId}`);
  return {
    ok: true,
    message: permissions.length ? "Event access saved." : "Event access removed.",
  };
}

const detailsSchema = eventSchema.pick({
  short_description: true,
  description: true,
  eligibility: true,
  venue: true,
  event_date: true,
  start_time: true,
  end_time: true,
  rules: true,
});

const DETAILS_ERRORS: Record<string, string> = {
  FORBIDDEN: "You don't have permission to edit this event.",
  EVENT_NOT_FOUND: "That event no longer exists.",
  INVALID_EVENT_DETAILS: "Check the event details.",
  INVALID_EVENT_RULES: "Check the rules.",
};

/**
 * Event administrator (events permission): save the event's descriptive
 * details. Everything else on the event stays with global events admins.
 */
export async function updateEventDetails(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireEventArea("events");
  const id = String(formData.get("id") ?? "");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Missing event id." };

  const parsed = detailsSchema.safeParse({
    short_description: formData.get("short_description"),
    description: formData.get("description"),
    eligibility: formData.get("eligibility"),
    venue: formData.get("venue"),
    event_date: formData.get("event_date"),
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time"),
    rules: formData.get("rules"),
  });
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return { ok: false, error: first ?? "Please check the form." };
  }
  const rules = parseRulesText(parsed.data.rules);
  const rulesProblem = rulesError(rules);
  if (rulesProblem) return { ok: false, error: rulesProblem };

  const supabase = await createClient();
  const { error } = await supabase.rpc("event_admin_update_event_details", {
    p_event_id: id,
    p_short_description: parsed.data.short_description,
    p_description: parsed.data.description ?? "",
    p_eligibility: parsed.data.eligibility ?? "",
    p_venue: parsed.data.venue ?? "",
    p_event_date: parsed.data.event_date || null,
    p_start_time: parsed.data.start_time || null,
    p_end_time: parsed.data.end_time || null,
    p_rules: rules,
  });
  if (error) {
    console.error("event_admin_update_event_details failed:", error);
    for (const key of Object.keys(DETAILS_ERRORS)) {
      if (error.message?.includes(key)) return { ok: false, error: DETAILS_ERRORS[key] };
    }
    return { ok: false, error: "Could not save the event details." };
  }
  revalidatePath("/admin/events");
  revalidatePath(`/admin/events/${id}/edit`);
  revalidatePath("/events");
  revalidatePath("/events/[slug]", "page");
  revalidatePath("/schedule");
  return { ok: true, message: "Event details saved." };
}

/** Events permission on the event: set or clear its private WhatsApp link. */
export async function setEventWhatsAppLink(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireEventArea("events");
  const id = String(formData.get("id") ?? "");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Missing event id." };
  const link = parseWhatsAppGroupUrl(formData.get("whatsapp_group_url"));
  if (!link.ok) return link;

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_event_whatsapp_link", {
    p_event_id: id,
    p_url: link.url,
  });
  if (error) {
    console.error("admin_set_event_whatsapp_link failed:", error);
    if (error.message?.includes("INVALID_WHATSAPP_LINK"))
      return { ok: false, error: "Use a WhatsApp group invite link like https://chat.whatsapp.com/AbCdEf123456." };
    if (error.message?.includes("FORBIDDEN"))
      return { ok: false, error: "You don't have permission to edit this event." };
    if (error.message?.includes("EVENT_NOT_FOUND")) return { ok: false, error: "That event no longer exists." };
    return { ok: false, error: "Could not save the WhatsApp link." };
  }
  revalidatePath(`/admin/events/${id}/edit`);
  return { ok: true, message: link.url ? "WhatsApp link saved." : "WhatsApp link removed." };
}
