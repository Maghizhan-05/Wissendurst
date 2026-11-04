import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMail } from "./mailer";
import {
  approvalGrantedEmail,
  approvalRejectedEmail,
  paymentConfirmedEmail,
  paymentUnderReviewEmail,
  registrationEmail,
  signupPendingEmail,
  welcomeEmail,
} from "./templates";
import type { EventRow, ProfileRow, RegistrationRow } from "@/types/database";

/** Fetches a registration with its event + owner profile (admin client). */
async function loadRegistration(registrationId: string): Promise<{
  registration: RegistrationRow;
  event: EventRow;
  profile: ProfileRow;
} | null> {
  const admin = createAdminClient();
  const { data: reg } = await admin
    .from("registrations")
    .select("*, event:events(*)")
    .eq("id", registrationId)
    .maybeSingle();
  if (!reg) return null;

  const registration = reg as RegistrationRow & { event: EventRow };
  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", registration.profile_id)
    .maybeSingle();
  if (!profile) return null;

  return {
    registration,
    event: registration.event,
    profile: profile as ProfileRow,
  };
}

async function loadProfile(userId: string): Promise<ProfileRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  return (data as ProfileRow) ?? null;
}

export async function notifyWelcome(userId: string): Promise<void> {
  const p = await loadProfile(userId);
  if (!p) return;
  const { subject, html } = welcomeEmail(p.full_name, p.participant_id ?? "");
  await sendMail({ to: p.email, subject, html });
}

export async function notifySignupPending(userId: string): Promise<void> {
  const p = await loadProfile(userId);
  if (!p) return;
  const { subject, html } = signupPendingEmail(p.full_name);
  await sendMail({ to: p.email, subject, html });
}

export async function notifyApproval(userId: string): Promise<void> {
  const p = await loadProfile(userId);
  if (!p) return;
  const { subject, html } = approvalGrantedEmail(p.full_name, p.participant_id ?? "");
  await sendMail({ to: p.email, subject, html });
}

export async function notifyRejection(userId: string): Promise<void> {
  const p = await loadProfile(userId);
  if (!p) return;
  const { subject, html } = approvalRejectedEmail(p.full_name);
  await sendMail({ to: p.email, subject, html });
}

/**
 * Sends the "you're confirmed" email for a registration that has just become
 * confirmed — a free / fully discounted registration, or a verified payment.
 * A team gets one email per (non-cancelled) member. Never call this for a
 * payment intent that is still pending.
 */
export async function notifyRegistrationConfirmed(
  registrationId: string,
): Promise<void> {
  const data = await loadRegistration(registrationId);
  if (!data || data.registration.registration_status !== "confirmed") return;

  const admin = createAdminClient();
  let recipientIds = [data.registration.profile_id];
  let teamAmount = data.registration.amount;
  if (data.registration.team_id) {
    const { data: rows } = await admin
      .from("registrations")
      .select("profile_id, amount, is_team_head, registration_status")
      .eq("team_id", data.registration.team_id);
    const team = (rows ?? []) as Pick<
      RegistrationRow,
      "profile_id" | "amount" | "is_team_head" | "registration_status"
    >[];
    recipientIds = team
      .filter((r) => r.registration_status === "confirmed")
      .map((r) => r.profile_id);
    teamAmount = team.find((r) => r.is_team_head)?.amount ?? teamAmount;
  }

  for (const profileId of recipientIds) {
    const p =
      profileId === data.profile.id ? data.profile : await loadProfile(profileId);
    if (!p) continue;
    const { subject, html } =
      teamAmount === 0
        ? registrationEmail(p.full_name, p.participant_id ?? "", data.event, 0)
        : paymentConfirmedEmail(p.full_name, data.event);
    try {
      await sendMail({ to: p.email, subject, html });
    } catch (e) {
      console.error(`confirmation email to ${profileId} failed:`, e);
    }
  }
}

export async function notifyPaymentUnderReview(registrationId: string): Promise<void> {
  const data = await loadRegistration(registrationId);
  if (!data) return;
  const { subject, html } = paymentUnderReviewEmail(
    data.profile.full_name,
    data.event,
    data.registration.amount,
    data.registration.transaction_id,
  );
  await sendMail({ to: data.profile.email, subject, html });
}
