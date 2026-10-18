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

export interface ParentOption {
  id: string;
  title: string;
  depth: number; // 0 = top-level event, 1 = sub-event
}

/**
 * Events that can be chosen as a "broader event" parent: depth 0 or 1 (so a
 * child lands at depth 1 or 2 — three tiers max), excluding `excludeId` and
 * everything under it (can't nest an event inside its own subtree).
 */
export async function getParentEventOptions(
  excludeId?: string,
): Promise<ParentOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("events").select("id, title, parent_event_id");
  const rows =
    (data as { id: string; title: string; parent_event_id: string | null }[]) ??
    [];

  const parentOf = new Map(rows.map((r) => [r.id, r.parent_event_id]));
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    if (r.parent_event_id) {
      const arr = childrenOf.get(r.parent_event_id) ?? [];
      arr.push(r.id);
      childrenOf.set(r.parent_event_id, arr);
    }
  }

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

  // Ids inside excludeId's subtree (excludeId included) are not valid parents.
  const excluded = new Set<string>();
  if (excludeId) {
    const stack = [excludeId];
    while (stack.length) {
      const id = stack.pop() as string;
      if (excluded.has(id)) continue;
      excluded.add(id);
      for (const k of childrenOf.get(id) ?? []) stack.push(k);
    }
  }

  return rows
    .map((r) => ({ id: r.id, title: r.title, depth: depthOf(r.id) }))
    .filter((o) => o.depth < 2 && !excluded.has(o.id))
    .sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title));
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
