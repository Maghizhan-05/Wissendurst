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

export async function notifyRegistration(registrationId: string): Promise<void> {
  const data = await loadRegistration(registrationId);
  if (!data) return;
  const { subject, html } = registrationEmail(
    data.profile.full_name,
    data.profile.participant_id ?? "",
    data.event,
    data.registration.amount,
  );
  await sendMail({ to: data.profile.email, subject, html });
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

export async function notifyPaymentConfirmed(registrationId: string): Promise<void> {
  const data = await loadRegistration(registrationId);
  if (!data) return;
  const { subject, html } = paymentConfirmedEmail(
    data.profile.full_name,
    data.event,
  );
  await sendMail({ to: data.profile.email, subject, html });
}
