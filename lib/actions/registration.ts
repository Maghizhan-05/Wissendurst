"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyRegistrationConfirmed } from "@/lib/email/notify";
import type { RegistrationRow } from "@/types/database";

/**
 * `next` is set only when a FREE registration was confirmed: the event page
 * navigates there itself (instead of a server redirect) so it can record the
 * anonymous, consent-gated `free_registration_confirmed` event first (D-024).
 */
export type ActionResult = { ok: false; error: string } | { ok: true; next?: string };

const FREE_CONFIRMED_NEXT = "/dashboard/registrations?joined=1";

const RPC_ERRORS: Record<string, string> = {
  AUTH_REQUIRED: "Please sign in to register.",
  ACCOUNT_BANNED: "Your account is suspended, so you can't register.",
  MEMBER_BANNED: "One of the teammates can't be registered right now.",
  EVENT_NOT_FOUND: "That event no longer exists.",
  EVENT_ARCHIVED: "This event has been archived and is no longer accepting registrations.",
  HAS_SUBEVENTS: "Pick one of the sub-events to register for.",
  NOT_LIVE: "Registration for this event hasn't opened yet — coming soon.",
  REGISTRATION_CLOSED: "Registration for this event is closed.",
  GENERAL_REGISTRATION_REQUIRED:
    "This event is included in General Registration. Complete General Registration first (every team member needs it too), then enrol here for free.",
  ALREADY_REGISTERED: "You're already registered for this event.",
  EVENT_FULL: "This event has reached capacity.",
  NOT_TEAM_EVENT: "This event isn't a team event.",
  TEAM_EVENT: "This event needs a team — use the team registration form.",
  TEAM_TOO_SMALL: "Your team has fewer members than this event allows.",
  TEAM_TOO_LARGE: "Your team has more members than this event allows.",
  MEMBER_NOT_APPROVED:
    "One of the teammates hasn't finished signing up yet.",
  MEMBER_ALREADY_REGISTERED:
    "You or a teammate is already registered for this event.",
  TEAM_NAME_REQUIRED: "Give your team a name (1–60 characters).",
  TEAM_NAME_INVALID: "Team names can be at most 60 characters, without line breaks.",
  TEAM_PRICE_MISSING: "This event has no price for a team of that size yet. Contact the organizers.",
  ROSTER_LOCKED:
    "This team can't be changed any more — payment has been submitted, or the seat hold has ended.",
  REGISTRATION_NOT_FOUND: "That registration wasn't found, or you aren't its team head.",
  NOT_TEAM_HEAD: "Only your team head can withdraw the team's registration — ask them.",
  NOT_CANCELLABLE:
    "This registration can't be withdrawn any more — a payment has been submitted or it has already been processed.",
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

  // A paid registration is only a payment intent: no confirmation email until
  // an organizer verifies the payment. Free / fully discounted registrations
  // are confirmed immediately. (Must run before redirect throws.)
  if (reg.registration_status === "confirmed") {
    try {
      await notifyRegistrationConfirmed(reg.id);
    } catch (e) {
      console.error("registration email failed:", e);
    }
  }

  if (reg.payment_status === "verified") {
    // Free event — already confirmed; the event page navigates to `next`.
    return { ok: true, next: FREE_CONFIRMED_NEXT };
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
  /** Editing an existing team: its own members don't count as registered. */
  headRegistrationId?: string,
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
    return { ok: false, error: `${pid} hasn't finished signing up yet.` };
  // Suspended accounts can't be enrolled (the database refuses it too).
  const { data: memberBan } = await admin
    .from("profile_bans")
    .select("profile_id")
    .in("profile_id", [p.id, user.id]);
  if ((memberBan ?? []).some((b) => (b as { profile_id: string }).profile_id === user.id))
    return { ok: false, error: RPC_ERRORS.ACCOUNT_BANNED };
  if ((memberBan ?? []).length > 0)
    return { ok: false, error: `${pid} can't be added to a team right now.` };

  // Editing: the team is resolved through the caller's own head row (RLS).
  let excludeTeamId: string | null = null;
  if (headRegistrationId) {
    const { data: own } = await supabase
      .from("registrations")
      .select("team_id, event_id, is_team_head, profile_id")
      .eq("id", headRegistrationId)
      .maybeSingle();
    const head = own as
      | { team_id: string | null; event_id: string; is_team_head: boolean; profile_id: string }
      | null;
    if (!head || head.profile_id !== user.id || !head.is_team_head || head.event_id !== eventId)
      return { ok: false, error: "That registration wasn't found." };
    excludeTeamId = head.team_id;
  }

  // Cancelled rows and expired payment intents don't block a new team, and an
  // eligible solo unpaid intent is absorbed by the team RPC (0036).
  const { data: blocked, error: blockErr } = await admin.rpc("registration_blocks_team_add", {
    p_profile_id: p.id,
    p_event_id: eventId,
    p_exclude_team_id: excludeTeamId,
  });
  if (blockErr) {
    console.error("registration_blocks_team_add failed:", blockErr);
    return { ok: false, error: "Couldn't check that participant. Try again." };
  }
  if (blocked === true)
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

  const memberIds = readMemberIds(formData);
  const teamName = String(formData.get("team_name") ?? "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/events/${slug}`);

  const { data, error } = await supabase.rpc("register_team", {
    p_event_id: eventId,
    p_member_ids: memberIds,
    p_team_name: teamName || null,
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

  // Confirmation emails only for a free team (confirmed immediately); paid
  // teams are emailed when the head's payment is verified.
  if (reg.registration_status === "confirmed") {
    try {
      await notifyRegistrationConfirmed(reg.id);
    } catch (e) {
      console.error("team registration email failed:", e);
    }
  }

  if (reg.payment_status === "verified") {
    return { ok: true, next: FREE_CONFIRMED_NEXT };
  }
  redirect(`/dashboard/payment/${reg.id}`);
}

function readMemberIds(formData: FormData): string[] {
  try {
    const parsed = JSON.parse(String(formData.get("member_ids") ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Team head changes teammates and/or the team name before paying (0030).
 * Removed teammates' registrations are deleted; the price follows the new
 * size; the seat hold is never extended. Refused once payment evidence exists.
 */
export async function editTeamRoster(formData: FormData): Promise<ActionResult> {
  const registrationId = String(formData.get("registration_id") ?? "");
  if (!registrationId) return { ok: false, error: "Missing registration." };
  const memberIds = readMemberIds(formData);
  const teamName = String(formData.get("team_name") ?? "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/dashboard/payment/${registrationId}`);

  const { data, error } = await supabase.rpc("edit_team_roster", {
    p_registration_id: registrationId,
    p_member_ids: memberIds,
    p_team_name: teamName || null,
  });
  if (error) {
    console.error("edit_team_roster failed:", error);
    return { ok: false, error: mapRpcError(error.message) };
  }
  const reg = (Array.isArray(data) ? data[0] : data) as RegistrationRow | null;

  revalidatePath("/dashboard/registrations");
  revalidatePath(`/dashboard/payment/${registrationId}`);
  revalidatePath("/admin/registrations");

  // Shrinking to a free size confirms the team straight away.
  if (reg?.registration_status === "confirmed") {
    try {
      await notifyRegistrationConfirmed(reg.id);
    } catch (e) {
      console.error("team confirmation email failed:", e);
    }
    redirect("/dashboard/registrations?joined=1");
  }
  return { ok: true };
}

/** Cancels the current user's still-unpaid registration. */
/**
 * D-029: withdraws the caller's genuinely unpaid registration through
 * cancel_my_registration (0036): a solo intent, or — for a team head — the
 * whole unpaid team. The database checks ownership, head status and payment
 * evidence under the event lock. No email is sent.
 */
export async function withdrawRegistration(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("registration_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  if (!id) return { ok: false, error: "Missing registration." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("cancel_my_registration", {
    p_registration_id: id,
  });
  if (error) {
    console.error("cancel_my_registration failed:", { code: error.code, message: error.message });
    return { ok: false, error: mapRpcError(error.message) };
  }

  revalidatePath("/dashboard/registrations");
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/payment/${id}`);
  if (slug) revalidatePath(`/events/${slug}`);
  // Back to the event, which is registerable again.
  return { ok: true, next: slug ? `/events/${encodeURIComponent(slug)}` : "/events" };
}
