import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  EventRow,
  ProfileRow,
  RegistrationRow,
  RegistrationWithEventAndProfile,
} from "@/types/database";

async function countRegistrations(
  filter?: { column: "registration_status" | "payment_status"; neq?: string; eq?: string },
): Promise<number> {
  const supabase = await createClient();
  let query = supabase
    .from("registrations")
    .select("*", { count: "exact", head: true });
  if (filter?.neq) query = query.neq(filter.column, filter.neq);
  if (filter?.eq) query = query.eq(filter.column, filter.eq);
  const { count: c } = await query;
  return c ?? 0;
}

async function countProfiles(): Promise<number> {
  const supabase = await createClient();
  const { count: c } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true });
  return c ?? 0;
}

export interface AdminStats {
  users: number;
  registrations: number;
  verified: number;
  underReview: number;
  duplicates: number;
  revenuePaise: number;
  perEvent: { title: string; count: number }[];
}

export async function getAdminStats(): Promise<AdminStats> {
  const supabase = await createClient();

  const [users, registrations, verified, underReview, duplicates] =
    await Promise.all([
      countProfiles(),
      countRegistrations({ column: "registration_status", neq: "cancelled" }),
      countRegistrations({ column: "payment_status", eq: "verified" }),
      countRegistrations({ column: "payment_status", eq: "under_review" }),
      countRegistrations({ column: "payment_status", eq: "duplicate" }),
    ]);

  const { data: verifiedRows } = await supabase
    .from("registrations")
    .select("amount")
    .eq("payment_status", "verified");
  const revenuePaise = (verifiedRows ?? []).reduce(
    (s, r) => s + ((r as { amount: number }).amount ?? 0),
    0,
  );

  const { data: regRows } = await supabase
    .from("registrations")
    .select("event:events(title)")
    .neq("registration_status", "cancelled");
  const tally = new Map<string, number>();
  type JoinRow = { event: { title: string } | { title: string }[] | null };
  for (const r of (regRows ?? []) as unknown as JoinRow[]) {
    const ev = Array.isArray(r.event) ? r.event[0] : r.event;
    const title = ev?.title ?? "Unknown";
    tally.set(title, (tally.get(title) ?? 0) + 1);
  }
  const perEvent = [...tally.entries()]
    .map(([title, c]) => ({ title, count: c }))
    .sort((a, b) => b.count - a.count);

  return {
    users,
    registrations,
    verified,
    underReview,
    duplicates,
    revenuePaise,
    perEvent,
  };
}

export async function getAllEventsAdmin(): Promise<EventRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("*")
    .order("created_at", { ascending: false });
  return (data as EventRow[]) ?? [];
}

/** Top-level events usable as a "broader event" parent, minus `excludeId`. */
export async function getTopLevelEventOptions(
  excludeId?: string,
): Promise<{ id: string; title: string }[]> {
  const supabase = await createClient();
  let query = supabase
    .from("events")
    .select("id, title")
    .is("parent_event_id", null)
    .order("title", { ascending: true });
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query;
  return (data as { id: string; title: string }[]) ?? [];
}

export async function getEventByIdAdmin(id: string): Promise<EventRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as EventRow) ?? null;
}

export interface RegistrationFilters {
  event?: string;
  payment?: string;
  registration?: string;
  duplicatesOnly?: boolean;
}

export async function getRegistrationsAdmin(
  filters: RegistrationFilters = {},
): Promise<RegistrationWithEventAndProfile[]> {
  const supabase = await createClient();
  let query = supabase
    .from("registrations")
    .select(
      "*, event:events(id,slug,title,registration_fee), profile:profiles!profile_id(id,participant_id,full_name,email,phone)",
    )
    .order("registered_at", { ascending: false });

  if (filters.event) query = query.eq("event_id", filters.event);
  if (filters.payment) query = query.eq("payment_status", filters.payment);
  if (filters.registration)
    query = query.eq("registration_status", filters.registration);
  if (filters.duplicatesOnly) query = query.eq("payment_status", "duplicate");

  const { data } = await query;
  return (data as RegistrationWithEventAndProfile[]) ?? [];
}

export async function getRegistrationAdmin(
  id: string,
): Promise<RegistrationWithEventAndProfile | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("registrations")
    .select(
      "*, event:events(id,slug,title,registration_fee), profile:profiles!profile_id(id,participant_id,full_name,email,phone)",
    )
    .eq("id", id)
    .maybeSingle();
  return (data as RegistrationWithEventAndProfile) ?? null;
}

/** Payment review queue: uploaded/under_review/duplicate first. */
export async function getPaymentQueue(): Promise<
  RegistrationWithEventAndProfile[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("registrations")
    .select(
      "*, event:events(id,slug,title,registration_fee), profile:profiles!profile_id(id,participant_id,full_name,email,phone)",
    )
    .in("payment_status", ["uploaded", "under_review", "duplicate"])
    .order("registered_at", { ascending: true });
  return (data as RegistrationWithEventAndProfile[]) ?? [];
}

export async function getPendingSignups(): Promise<ProfileRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("approval_status", "pending")
    .order("created_at", { ascending: true });
  return (data as ProfileRow[]) ?? [];
}

export async function countPendingSignups(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("approval_status", "pending");
  return count ?? 0;
}

export async function getProfileAdmin(id: string): Promise<ProfileRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as ProfileRow) ?? null;
}

export async function getUsersAdmin(search?: string): Promise<ProfileRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    query = query.or(
      `full_name.ilike.${s},email.ilike.${s},participant_id.ilike.${s}`,
    );
  }
  const { data } = await query;
  return (data as ProfileRow[]) ?? [];
}

export async function getUserWithRegistrations(id: string): Promise<{
  profile: ProfileRow;
  registrations: (RegistrationRow & { event: Pick<EventRow, "title" | "slug"> })[];
} | null> {
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!profile) return null;

  const { data: registrations } = await supabase
    .from("registrations")
    .select("*, event:events(title,slug)")
    .eq("profile_id", id)
    .order("registered_at", { ascending: false });

  return {
    profile: profile as ProfileRow,
    registrations: (registrations as never) ?? [],
  };
}
