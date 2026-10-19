"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyRegistration } from "@/lib/email/notify";
import type { RegistrationRow } from "@/types/database";

export type ActionResult = { ok: false; error: string } | { ok: true };

const RPC_ERRORS: Record<string, string> = {
  AUTH_REQUIRED: "Please sign in to register.",
  EVENT_NOT_FOUND: "That event no longer exists.",
  HAS_SUBEVENTS: "Pick one of the sub-events to register for.",
  NOT_LIVE: "Registration for this event hasn't opened yet — coming soon.",
  REGISTRATION_CLOSED: "Registration for this event is closed.",
  ALREADY_REGISTERED: "You're already registered for this event.",
  EVENT_FULL: "This event has reached capacity.",
  NOT_TEAM_EVENT: "This event isn't a team event.",
  TEAM_TOO_SMALL: "Your team has fewer members than this event allows.",
  TEAM_TOO_LARGE: "Your team has more members than this event allows.",
  MEMBER_NOT_APPROVED:
    "One of the teammates isn't an approved participant yet.",
  MEMBER_ALREADY_REGISTERED:
    "You or a teammate is already registered for this event.",
};

function mapRpcError(message: string | undefined): string {
  if (!message) return "Something went wrong. Please try again.";
  for (const key of Object.keys(RPC_ERRORS)) {
    if (message.includes(key)) return RPC_ERRORS[key];
  }
  // Common setup problems get a clear, actionable message instead of a
  // generic one — these mean the DB functions/grants aren't in place.
  const m = message.toLowerCase();
  if (m.includes("could not find the function") || m.includes("schema cache")) {
    return "Registration isn't set up on the server yet (missing database function). Run supabase/migrations/0003_functions.sql on your Supabase project.";
  }
  if (m.includes("permission denied")) {
    return "The server denied the registration function. Re-run supabase/migrations/0003_functions.sql (it grants EXECUTE to authenticated users).";
  }
  // Surface the real reason rather than hiding it behind a generic popup.
  return `Registration failed: ${message}`;
}

/**
 * Registers the current user for an event via the capacity-safe RPC, then
 * routes to payment (paid events) or the registrations list (free events).
 */
export async function registerForEvent(formData: FormData): Promise<ActionResult> {
  const eventId = String(formData.get("event_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  if (!eventId) return { ok: false, error: "Missing event." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/events/${slug}`);

  // Team events must go through the team flow, not solo registration.
  const { data: ev } = await supabase
    .from("events")
    .select("team_enabled")
    .eq("id", eventId)
    .maybeSingle();
  if ((ev as { team_enabled?: boolean } | null)?.team_enabled) {
    return {
      ok: false,
      error: "This event needs a team — use the team registration form.",
    };
  }

  const { data, error } = await supabase.rpc("register_for_event", {
    p_event_id: eventId,
  });
  if (error) {
    // Log the full error so it also appears in the Vercel function logs.
    console.error("register_for_event failed:", error);
    return { ok: false, error: mapRpcError(error.message) };
  }

  // PostgREST may return the composite row as an object or a single-item array.
  const reg = (Array.isArray(data) ? data[0] : data) as RegistrationRow | null;
  if (!reg?.id) {
    return {
      ok: false,
      error: "Registration didn't complete. Please try again.",
    };
  }

  revalidatePath("/dashboard/registrations");
  revalidatePath(`/events/${slug}`);

  // Best-effort registration email (must run before redirect throws).
  try {
    await notifyRegistration(reg.id);
  } catch (e) {
    console.error("registration email failed:", e);
  }

  if (reg.payment_status === "verified") {
    // Free event — already confirmed.
    redirect("/dashboard/registrations?joined=1");
  }
  redirect(`/dashboard/payment/${reg.id}`);
}

export type TeamMember = {
  id: string;
  participant_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  college: string | null;
};
export type MemberLookup =
  | { ok: true; member: TeamMember }
  | { ok: false; error: string };

/**
 * Resolves a teammate by their participant ID (W27/E/…) so the team form can
 * auto-fill their details. Validates the teammate is approved and not already
 * registered for this event. Uses the service role to read the teammate's
 * basic contact details for the team head.
 */
export async function lookupTeamMember(
  participantId: string,
  eventId: string,
): Promise<MemberLookup> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in." };

  const pid = participantId.trim();
  if (!pid) return { ok: false, error: "Enter a participant ID." };
  if (!eventId) return { ok: false, error: "Missing event." };

  const admin = createAdminClient();
  const { data: prof } = await admin
    .from("profiles")
    .select("id, participant_id, full_name, email, phone, college, approval_status")
    .eq("participant_id", pid)
    .maybeSingle();
  const p = prof as
    | (TeamMember & { approval_status: string })
    | null;
  if (!p) return { ok: false, error: `No participant found with ID ${pid}.` };
  if (p.approval_status !== "approved")
    return { ok: false, error: `${pid} isn't an approved participant yet.` };

  const { data: existing } = await admin
    .from("registrations")
    .select("id")
    .eq("event_id", eventId)
    .eq("profile_id", p.id)
    .neq("registration_status", "cancelled")
    .maybeSingle();
  if (existing)
    return { ok: false, error: `${pid} is already registered for this event.` };

  return {
    ok: true,
    member: {
      id: p.id,
      participant_id: p.participant_id,
      full_name: p.full_name,
      email: p.email,
      phone: p.phone ?? null,
      college: p.college ?? null,
    },
  };
}

/**
 * Registers a team. `member_ids` is a JSON array of teammate profile ids
 * (resolved via lookupTeamMember); the head (current user) is added
 * automatically by the RPC. Routes the head to payment.
 */
export async function registerTeam(formData: FormData): Promise<ActionResult> {
  const eventId = String(formData.get("event_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  if (!eventId) return { ok: false, error: "Missing event." };

  let memberIds: string[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("member_ids") ?? "[]"));
    if (Array.isArray(parsed)) memberIds = parsed.map(String);
  } catch {
    memberIds = [];
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/events/${slug}`);

  const { data, error } = await supabase.rpc("register_team", {
    p_event_id: eventId,
    p_member_ids: memberIds,
  });
  if (error) {
    console.error("register_team failed:", error);
    return { ok: false, error: mapRpcError(error.message) };
  }

  const reg = (Array.isArray(data) ? data[0] : data) as RegistrationRow | null;
  if (!reg?.id) {
    return {
      ok: false,
      error: "Team registration didn't complete. Please try again.",
    };
  }

  revalidatePath("/dashboard/registrations");
  revalidatePath(`/events/${slug}`);

  try {
    await notifyRegistration(reg.id);
  } catch (e) {
    console.error("team registration email failed:", e);
  }

  if (reg.payment_status === "verified") {
    redirect("/dashboard/registrations?joined=1");
  }
  redirect(`/dashboard/payment/${reg.id}`);
}

/** Cancels the current user's still-unpaid registration. */
export async function cancelRegistration(formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("registration_id") ?? "");
  if (!id) return { ok: false, error: "Missing registration." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_registration", {
    p_registration_id: id,
  });

  if (error) return { ok: false, error: "Could not cancel registration." };
  revalidatePath("/dashboard/registrations");
  return { ok: true };
}
