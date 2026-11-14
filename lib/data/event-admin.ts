import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { queryError } from "@/lib/supabase/query-error";
import { BUCKETS } from "@/lib/constants";
import type { PaymentStatus, RegistrationStatus } from "@/lib/constants";
import type { EventRow, RegistrationWithEventAndProfile } from "@/types/database";

/*
 * Loaders for per-event administrators (0034). These accounts may hold no
 * global scope (and need no admin role), so Row Level Security doesn't give
 * them the rows; the server reads with the service role AFTER the caller has
 * resolved the account's permission (lib/auth: requireEventArea / canOnEvent)
 * and always filters to the permitted event ids. Contact loaders select only
 * contact-focused columns — never UTRs, screenshots, OCR text or amounts.
 */

export interface AssignedEvent {
  id: string;
  slug: string;
  title: string;
  event_date: string | null;
  archived_at: string | null;
}

/** Events by id (archived ones included — admins still need their history). */
export async function getEventsByIds(ids: readonly string[]): Promise<AssignedEvent[]> {
  if (ids.length === 0) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("events")
    .select("id, slug, title, event_date, archived_at")
    .in("id", [...ids])
    .order("title", { ascending: true });
  if (error) throw queryError("getEventsByIds", error);
  return (data ?? []) as AssignedEvent[];
}

/** A confirmed registration as listed for event administrators. */
export interface RosterRow {
  id: string;
  event_id: string;
  team_id: string | null;
  is_team_head: boolean;
  registered_at: string;
  registration_status: RegistrationStatus;
  payment_status: PaymentStatus;
  event: { id: string; slug: string; title: string };
  profile: { id: string; participant_id: string | null; full_name: string };
  team?: { name: string | null; member_count: number; code: string | null } | null;
}

const ROSTER_SELECT =
  "id, event_id, team_id, is_team_head, registered_at, registration_status, payment_status, event:events!registrations_event_id_fkey(id,slug,title), profile:profiles!profile_id(id,participant_id,full_name), team:teams!team_id(name,member_count,code)";

/**
 * Confirmed registrations of the given events (Admin Registrations for event
 * administrators). Same confirmed-only rule as getRegistrationsAdmin.
 */
export async function getRegistrationsForEvents(
  eventIds: readonly string[],
): Promise<RosterRow[]> {
  if (eventIds.length === 0) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("registrations")
    .select(ROSTER_SELECT)
    .in("event_id", [...eventIds])
    .eq("registration_status", "confirmed")
    .order("registered_at", { ascending: false });
  if (error) throw queryError("getRegistrationsForEvents", error);
  return (data ?? []) as unknown as RosterRow[];
}

export interface ContactPerson {
  registrationId: string;
  isTeamHead: boolean;
  participantId: string | null;
  fullName: string;
  email: string;
  phone: string | null;
  college: string | null;
  course: string | null;
  year: string | null;
  /** For the Users-scope ID card view only; never rendered as text. */
  profileId: string | null;
  idCardPath: string | null;
}

/** Contact-focused registration detail (no payment evidence). */
export interface RegistrationContact {
  id: string;
  eventId: string;
  event: { id: string; slug: string; title: string; event_date: string | null };
  registeredAt: string;
  registrationStatus: RegistrationStatus;
  paymentStatus: PaymentStatus;
  team: { id: string; name: string | null; code: string | null; memberCount: number } | null;
  /** Head first (teams), then by name. One entry for a single registration. */
  people: ContactPerson[];
}

type ContactRow = {
  id: string;
  event_id: string;
  team_id: string | null;
  is_team_head: boolean;
  registered_at: string;
  registration_status: RegistrationStatus;
  payment_status: PaymentStatus;
  event: { id: string; slug: string; title: string; event_date: string | null } | null;
  profile: {
    id: string;
    id_card_path: string | null;
    participant_id: string | null;
    full_name: string;
    email: string;
    phone: string | null;
    college: string | null;
    course: string | null;
    year: string | null;
  } | null;
  team: { name: string | null; member_count: number; code: string | null } | null;
};

const CONTACT_SELECT =
  "id, event_id, team_id, is_team_head, registered_at, registration_status, payment_status, event:events!registrations_event_id_fkey(id,slug,title,event_date), profile:profiles!profile_id(id,id_card_path,participant_id,full_name,email,phone,college,course,year), team:teams!team_id(name,member_count,code)";

function person(r: ContactRow): ContactPerson {
  return {
    registrationId: r.id,
    isTeamHead: r.is_team_head,
    participantId: r.profile?.participant_id ?? null,
    fullName: r.profile?.full_name ?? "—",
    email: r.profile?.email ?? "",
    phone: r.profile?.phone ?? null,
    college: r.profile?.college ?? null,
    course: r.profile?.course ?? null,
    year: r.profile?.year ?? null,
    profileId: r.profile?.id ?? null,
    idCardPath: r.profile?.id_card_path ?? null,
  };
}

/**
 * A CONFIRMED registration with the contact details of the participant — or
 * of every confirmed member of its team. Null when there is no such confirmed
 * registration. The caller must check the event permission on `eventId`
 * before rendering anything.
 */
export async function getRegistrationContact(id: string): Promise<RegistrationContact | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("registrations")
    .select(CONTACT_SELECT)
    .eq("id", id)
    .eq("registration_status", "confirmed")
    .maybeSingle();
  if (error) throw queryError("getRegistrationContact", error);
  if (!data) return null;
  const reg = data as unknown as ContactRow;
  if (!reg.event) return null;

  let members: ContactRow[] = [reg];
  if (reg.team_id && reg.team && reg.team.member_count >= 2) {
    const { data: rows, error: teamError } = await admin
      .from("registrations")
      .select(CONTACT_SELECT)
      .eq("team_id", reg.team_id)
      .eq("registration_status", "confirmed");
    if (teamError) throw queryError("getRegistrationContact team", teamError);
    members = ((rows ?? []) as unknown as ContactRow[]).sort(
      (a, b) =>
        Number(b.is_team_head) - Number(a.is_team_head) ||
        (a.profile?.full_name ?? "").localeCompare(b.profile?.full_name ?? "", "en"),
    );
  }

  return {
    id: reg.id,
    eventId: reg.event_id,
    event: reg.event,
    registeredAt: reg.registered_at,
    registrationStatus: reg.registration_status,
    paymentStatus: reg.payment_status,
    team:
      reg.team_id && reg.team && reg.team.member_count >= 2
        ? { id: reg.team_id, name: reg.team.name, code: reg.team.code, memberCount: reg.team.member_count }
        : null,
    people: members.map(person),
  };
}

const PAYMENT_SELECT =
  "*, event:events!registrations_event_id_fkey(id,slug,title,registration_fee), profile:profiles!profile_id(id,participant_id,full_name,email,phone), team:teams!team_id(name,member_count,code)";

/** Payment review queue limited to the given events (payments assignees). */
export async function getPaymentQueueForEvents(
  eventIds: readonly string[],
): Promise<RegistrationWithEventAndProfile[]> {
  if (eventIds.length === 0) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("registrations")
    .select(PAYMENT_SELECT)
    .in("event_id", [...eventIds])
    .in("payment_status", ["uploaded", "under_review", "duplicate"])
    .order("registered_at", { ascending: true });
  if (error) throw queryError("getPaymentQueueForEvents", error);
  return (data as RegistrationWithEventAndProfile[]) ?? [];
}

/**
 * One registration for payment review by a payments assignee. The caller must
 * check canOnEvent(…, reg.event_id, "payments") before showing it.
 */
export async function getRegistrationForPaymentReview(
  id: string,
): Promise<RegistrationWithEventAndProfile | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("registrations")
    .select(PAYMENT_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw queryError("getRegistrationForPaymentReview", error);
  return (data as RegistrationWithEventAndProfile) ?? null;
}

/**
 * Short-lived signed URL for a payment screenshot, for a registration the
 * caller has already authorized (payments permission on its event).
 */
export async function signedScreenshotUrlForAuthorizedRegistration(
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  const admin = createAdminClient();
  const { data } = await admin.storage
    .from(BUCKETS.paymentScreenshots)
    .createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}

/** Leaf events (no sub-events) that an event administrator can be assigned to. */
export async function getAssignableEvents(): Promise<AssignedEvent[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("events")
    .select("id, slug, title, event_date, archived_at, parent_event_id")
    .order("title", { ascending: true });
  if (error) throw queryError("getAssignableEvents", error);
  const rows = (data ?? []) as (AssignedEvent & { parent_event_id: string | null })[];
  const parents = new Set(rows.map((r) => r.parent_event_id).filter(Boolean));
  return rows
    .filter((r) => !parents.has(r.id))
    .map(({ id, slug, title, event_date, archived_at }) => ({ id, slug, title, event_date, archived_at }));
}

/** Every event assignment of one account (super admin's user page). */
export async function getAssignmentsOfUser(
  profileId: string,
): Promise<{ event_id: string; permissions: ("events" | "payments")[] }[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("event_admin_assignments")
    .select("event_id, permissions")
    .eq("profile_id", profileId);
  if (error) throw queryError("getAssignmentsOfUser", error);
  return (data ?? []) as { event_id: string; permissions: ("events" | "payments")[] }[];
}

/**
 * The event's private WhatsApp group link for its editor. Read through the
 * permission-checked RPC with the caller's session (the table itself is closed
 * to every client role).
 */
export async function getEventWhatsAppLink(eventId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_get_event_whatsapp_link", {
    p_event_id: eventId,
  });
  if (error) throw queryError("admin_get_event_whatsapp_link", error);
  return typeof data === "string" ? data : null;
}

/** Full event row for its assignee's details editor (archived included). */
export async function getEventForAssignee(id: string): Promise<EventRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("events").select("*").eq("id", id).maybeSingle();
  if (error) throw queryError("getEventForAssignee", error);
  return (data as EventRow) ?? null;
}

/** The event's private Google Form link (0035) through the permission-checked RPC. */
export async function getEventGoogleFormLink(eventId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_get_event_google_form_link", {
    p_event_id: eventId,
  });
  if (error) throw queryError("admin_get_event_google_form_link", error);
  return typeof data === "string" ? data : null;
}
