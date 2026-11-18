import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliverLogged, auditNotificationFailure } from "./audit";
import { notificationJob, type DeliveryContext } from "./record";
import type { DeliveryOutcome } from "./delivery";
import {
  generalRegistrationRejectedEmail,
  generalRegistrationSubmittedEmail,
  generalRegistrationVerifiedEmail,
  paymentConfirmedEmail,
  paymentRejectedEmail,
  paymentUnderReviewEmail,
  registrationEmail,
  welcomeEmail,
} from "./templates";
import type {
  EventRow,
  GeneralRegistrationRow,
  ProfileRow,
  RegistrationRow,
} from "@/types/database";

/** Fetches a registration with its event + owner profile (admin client). */
async function loadRegistration(registrationId: string): Promise<{
  registration: RegistrationRow;
  event: EventRow;
  profile: ProfileRow;
} | null> {
  const admin = createAdminClient();
  const { data: reg, error } = await admin
    .from("registrations")
    .select("*, event:events!registrations_event_id_fkey(*)")
    .eq("id", registrationId)
    .maybeSingle();
  if (error) {
    // Emails are best-effort, but a failed lookup must be visible in the logs.
    throw new Error("LOOKUP_FAILED");
  }
  if (!reg) throw new Error("REGISTRATION_MISSING");

  const registration = reg as RegistrationRow & { event: EventRow };
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("*")
    .eq("id", registration.profile_id)
    .maybeSingle();
  if (profileError || !profile) throw new Error("PROFILE_MISSING");

  return {
    registration,
    event: registration.event,
    profile: profile as ProfileRow,
  };
}

async function loadProfile(userId: string): Promise<ProfileRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("PROFILE_MISSING");
  return data as ProfileRow;
}

async function notifyWelcomeImpl(userId: string): Promise<void> {
  const p = await loadProfile(userId);
  if (!p) return;
  const { subject, html } = welcomeEmail(p.full_name, p.participant_id ?? "");
  await deliverLogged({ kind: "welcome", source: "automatic" }, { to: p.email, subject, html });
}

/**
 * The event's private links (server-only table): WhatsApp group (0034) and
 * Google Form (0035). A failed lookup is logged and the confirmation still
 * goes out without them.
 */
async function loadEventPrivateLinks(
  eventId: string, context: DeliveryContext,
): Promise<{ whatsappUrl: string | null; googleFormUrl: string | null }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("event_private_settings")
    .select("whatsapp_group_url, google_form_url")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) {
    await auditNotificationFailure(context);
    return { whatsappUrl: null, googleFormUrl: null };
  }
  const row = data as { whatsapp_group_url: string | null; google_form_url: string | null } | null;
  return { whatsappUrl: row?.whatsapp_group_url ?? null, googleFormUrl: row?.google_form_url ?? null };
}

/**
 * Sends the "you're confirmed" email for a registration that has just become
 * confirmed — a free / fully discounted registration, or a verified payment.
 * A team gets one email per (non-cancelled) member. Never call this for a
 * payment intent that is still pending.
 */
async function notifyRegistrationConfirmedImpl(
  registrationId: string, context: DeliveryContext,
): Promise<DeliveryOutcome[]> {
  const data = await loadRegistration(registrationId);
  if (!data || data.registration.registration_status !== "confirmed" || data.registration.payment_status !== "verified") throw new Error("NOT_CONFIRMED");

  const admin = createAdminClient();
  let recipientIds = [data.registration.profile_id];
  let teamAmount = data.registration.amount;
  let teamName: string | null | undefined = undefined; // undefined = not a team
  if (data.registration.team_id) {
    const { data: rows, error: teamError } = await admin
      .from("registrations")
      .select("profile_id, amount, is_team_head, registration_status, payment_status")
      .eq("team_id", data.registration.team_id);
    if (teamError) throw new Error("TEAM_LOOKUP_FAILED");
    const team = (rows ?? []) as Pick<
      RegistrationRow,
      "profile_id" | "amount" | "is_team_head" | "registration_status" | "payment_status"
    >[];
    recipientIds = team
      .filter((r) => r.registration_status === "confirmed" && r.payment_status === "verified")
      .map((r) => r.profile_id);
    teamAmount = team.find((r) => r.is_team_head)?.amount ?? teamAmount;
    if (team.length > 1) {
      const { data: t, error: teamNameError } = await admin
        .from("teams")
        .select("name")
        .eq("id", data.registration.team_id)
        .maybeSingle();
      if (teamNameError) throw new Error("TEAM_LOOKUP_FAILED");
      teamName = (t as { name: string | null } | null)?.name ?? null;
    }
  }

  // Private event links, only in this successful-registration email, to each
  // confirmed participant / team member: the WhatsApp group (0034) always,
  // the Google Form (0035, D-023) only in the PAID payment-confirmed email.
  const { whatsappUrl, googleFormUrl } = await loadEventPrivateLinks(data.event.id, context);

  const outcomes: DeliveryOutcome[] = [];
  for (const profileId of recipientIds) {
    const outcome = await notificationJob(async () => {
      const p = profileId === data.profile.id ? data.profile : await loadProfile(profileId);
      if (!p) throw new Error("PROFILE_MISSING");
      const { subject, html } = teamAmount === 0
        ? registrationEmail(p.full_name, p.participant_id ?? "", data.event, 0, teamName, whatsappUrl)
        : paymentConfirmedEmail(p.full_name, data.event, teamName, whatsappUrl, googleFormUrl);
      return deliverLogged(context, { to: p.email, subject, html });
    }, () => auditNotificationFailure(context));
    outcomes.push(outcome ?? { status: "failed", errorClass: "unknown", errorCode: "UNKNOWN" });
  }
  return outcomes;
}

async function notifyPaymentUnderReviewImpl(registrationId: string): Promise<void> {
  const data = await loadRegistration(registrationId);
  if (!data) return;
  const { subject, html } = paymentUnderReviewEmail(
    data.profile.full_name,
    data.event,
    data.registration.amount,
    data.registration.transaction_id,
    data.registration.id,
  );
  await deliverLogged({ kind: "payment_status", source: "automatic", registrationId }, { to: data.profile.email, subject, html });
}

/** Payment rejected: tell the payer (team head) how to submit new evidence. */
async function notifyPaymentRejectedImpl(registrationId: string, note: string | null): Promise<void> {
  const data = await loadRegistration(registrationId);
  if (!data || data.registration.payment_status !== "rejected") return;
  const { subject, html } = paymentRejectedEmail(data.profile.full_name, data.event, registrationId, note);
  await deliverLogged({ kind: "payment_status", source: "automatic", registrationId }, { to: data.profile.email, subject, html });
}

async function loadGeneralRegistration(id: string): Promise<{
  gr: GeneralRegistrationRow;
  profile: ProfileRow;
} | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("general_registrations").select("*").eq("id", id).maybeSingle();
  if (error || !data) throw new Error("GENERAL_REGISTRATION_MISSING");
  const gr = data as GeneralRegistrationRow;
  const profile = await loadProfile(gr.profile_id);
  return profile ? { gr, profile } : null;
}

/** General Registration payment entered review (UTR submitted). */
async function notifyGeneralRegistrationSubmittedImpl(id: string): Promise<void> {
  const d = await loadGeneralRegistration(id);
  if (!d || d.gr.status !== "under_review") return;
  const { subject, html } = generalRegistrationSubmittedEmail(
    d.profile.full_name,
    d.gr.amount,
    d.gr.transaction_id,
  );
  await deliverLogged({ kind: "payment_status", source: "automatic" }, { to: d.profile.email, subject, html });
}

/** Verified: announces the new GR participant ID. */
async function notifyGeneralRegistrationVerifiedImpl(id: string): Promise<void> {
  const d = await loadGeneralRegistration(id);
  if (!d || d.gr.status !== "verified" || !d.gr.new_participant_id) return;
  const { subject, html } = generalRegistrationVerifiedEmail(
    d.profile.full_name,
    d.gr.previous_participant_id,
    d.gr.new_participant_id,
  );
  await deliverLogged({ kind: "payment_status", source: "automatic" }, { to: d.profile.email, subject, html });
}

async function notifyGeneralRegistrationRejectedImpl(id: string): Promise<void> {
  const d = await loadGeneralRegistration(id);
  if (!d || d.gr.status !== "rejected") return;
  const { subject, html } = generalRegistrationRejectedEmail(d.profile.full_name, d.gr.review_note);
  await deliverLogged({ kind: "payment_status", source: "automatic" }, { to: d.profile.email, subject, html });
}

export async function notifyWelcome(userId: string): Promise<void> {
 await notificationJob(() => notifyWelcomeImpl(userId), () => auditNotificationFailure({ kind: "welcome", source: "automatic" }));
}

export async function notifyPaymentUnderReview(registrationId: string): Promise<void> {
 await notificationJob(() => notifyPaymentUnderReviewImpl(registrationId), () => auditNotificationFailure({ kind: "payment_status", source: "automatic", registrationId }));
}

export async function notifyPaymentRejected(registrationId: string, note: string | null): Promise<void> {
 await notificationJob(() => notifyPaymentRejectedImpl(registrationId, note), () => auditNotificationFailure({ kind: "payment_status", source: "automatic", registrationId }));
}

export async function notifyGeneralRegistrationSubmitted(id: string): Promise<void> {
 await notificationJob(() => notifyGeneralRegistrationSubmittedImpl(id), () => auditNotificationFailure({ kind: "payment_status", source: "automatic" }));
}

export async function notifyGeneralRegistrationVerified(id: string): Promise<void> {
 await notificationJob(() => notifyGeneralRegistrationVerifiedImpl(id), () => auditNotificationFailure({ kind: "payment_status", source: "automatic" }));
}

export async function notifyGeneralRegistrationRejected(id: string): Promise<void> {
 await notificationJob(() => notifyGeneralRegistrationRejectedImpl(id), () => auditNotificationFailure({ kind: "payment_status", source: "automatic" }));
}

/** Automatic callers remain best effort; manual calls return sanitized per-send outcomes. */
export async function notifyRegistrationConfirmed(
 registrationId: string, manual?: { actorId: string },
): Promise<DeliveryOutcome[]> {
 const context: DeliveryContext = { kind: "registration_confirmed", source: manual ? "manual" : "automatic", registrationId, actorId: manual?.actorId ?? null };
 return (await notificationJob(() => notifyRegistrationConfirmedImpl(registrationId, context), () => auditNotificationFailure(context))) ?? [{ status: "failed", errorClass: "unknown", errorCode: "UNKNOWN" }];
}
