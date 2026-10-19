import { createClient } from "@/lib/supabase/server";
import type { EventRow } from "@/types/database";

/** All events, newest-dated first (nulls last). */
export async function getEvents(): Promise<EventRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("*")
    .order("featured", { ascending: false })
    .order("event_date", { ascending: true, nullsFirst: false });
  return (data as EventRow[]) ?? [];
}

/** Top-level events only (containers + standalones) — sub-events are hidden. */
export async function getTopLevelEvents(): Promise<EventRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("*")
    .is("parent_event_id", null)
    .order("featured", { ascending: false })
    .order("event_date", { ascending: true, nullsFirst: false });
  return (data as EventRow[]) ?? [];
}

/** Sub-events of a given parent, in display order. */
export async function getSubEvents(parentId: string): Promise<EventRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("*")
    .eq("parent_event_id", parentId)
    .order("event_date", { ascending: true, nullsFirst: false })
    .order("title", { ascending: true });
  return (data as EventRow[]) ?? [];
}

/** How many sub-events each container has, keyed by parent id. */
export async function getSubEventCounts(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("parent_event_id")
    .not("parent_event_id", "is", null);
  const counts: Record<string, number> = {};
  for (const r of (data ?? []) as { parent_event_id: string }[]) {
    counts[r.parent_event_id] = (counts[r.parent_event_id] ?? 0) + 1;
  }
  return counts;
}

export async function getEventById(id: string): Promise<EventRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as EventRow) ?? null;
}

/** Ancestors of an event, root first, excluding the event itself. */
export async function getEventAncestors(event: EventRow): Promise<EventRow[]> {
  const chain: EventRow[] = [];
  let parentId = event.parent_event_id;
  // Bounded walk (tree is max 3 deep); the Set guards against bad data.
  const seen = new Set<string>([event.id]);
  while (parentId && !seen.has(parentId) && chain.length < 5) {
    seen.add(parentId);
    const parent = await getEventById(parentId);
    if (!parent) break;
    chain.unshift(parent);
    parentId = parent.parent_event_id;
  }
  return chain;
}

/**
 * The sibling discount (in paise) a user would get registering for this event
 * right now — mirrors register_for_event: the nearest ancestor with the
 * discount enabled under which the user already has a verified payment on
 * another event. 0 when none applies. Used to preview the discount on the
 * event page before the user registers.
 */
export async function getEventDiscount(
  event: EventRow,
  userId: string | null,
): Promise<number> {
  if (!userId || event.registration_fee <= 0) return 0;

  const supabase = await createClient();
  const { data: evRows } = await supabase
    .from("events")
    .select("id, parent_event_id, discount_enabled, discount_amount");
  const rows =
    (evRows as {
      id: string;
      parent_event_id: string | null;
      discount_enabled: boolean;
      discount_amount: number;
    }[]) ?? [];

  const byId = new Map(rows.map((r) => [r.id, r]));
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    if (r.parent_event_id) {
      const a = childrenOf.get(r.parent_event_id) ?? [];
      a.push(r.id);
      childrenOf.set(r.parent_event_id, a);
    }
  }

  // Ancestors, nearest first.
  const ancestors: string[] = [];
  const seen = new Set<string>([event.id]);
  let cur = event.parent_event_id;
  while (cur && !seen.has(cur) && ancestors.length < 5) {
    seen.add(cur);
    ancestors.push(cur);
    cur = byId.get(cur)?.parent_event_id ?? null;
  }
  if (ancestors.length === 0) return 0;

  const { data: regRows } = await supabase
    .from("registrations")
    .select("event_id")
    .eq("profile_id", userId)
    .eq("payment_status", "verified");
  const verified = new Set(
    (regRows ?? []).map((r) => (r as { event_id: string }).event_id),
  );
  if (verified.size === 0) return 0;

  const subtree = (rootId: string): Set<string> => {
    const out = new Set<string>();
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop() as string;
      if (out.has(id)) continue;
      out.add(id);
      for (const c of childrenOf.get(id) ?? []) stack.push(c);
    }
    return out;
  };

  for (const ancId of ancestors) {
    const anc = byId.get(ancId);
    if (!anc?.discount_enabled || anc.discount_amount <= 0) continue;
    const ids = subtree(ancId);
    let eligible = false;
    for (const eid of verified) {
      if (eid !== event.id && ids.has(eid)) {
        eligible = true;
        break;
      }
    }
    if (eligible) return Math.min(anc.discount_amount, event.registration_fee);
  }
  return 0;
}

/**
 * The UPI id to charge for an event: its own, else the nearest ancestor's,
 * else null (caller falls back to the site default).
 */
export async function resolveEventUpiId(event: EventRow): Promise<string | null> {
  if (event.upi_id && event.upi_id.trim()) return event.upi_id.trim();
  const ancestors = await getEventAncestors(event); // root → parent
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const u = ancestors[i].upi_id;
    if (u && u.trim()) return u.trim();
  }
  return null;
}

export async function getFeaturedEvents(limit = 4): Promise<EventRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("*")
    .eq("featured", true)
    .order("event_date", { ascending: true, nullsFirst: false })
    .limit(limit);
  return (data as EventRow[]) ?? [];
}

export async function getEventBySlug(slug: string): Promise<EventRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return (data as EventRow) ?? null;
}

/** Slugs for generateStaticParams / sitemap. */
export async function getAllEventSlugs(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("events").select("slug");
  return (data ?? []).map((r) => (r as { slug: string }).slug);
}

/** Count of active (non-cancelled) registrations per event id. */
export async function getEventRegistrationCounts(): Promise<
  Record<string, number>
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("registrations")
    .select("event_id")
    .neq("registration_status", "cancelled");
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { event_id: string }[]) {
    counts[row.event_id] = (counts[row.event_id] ?? 0) + 1;
  }
  return counts;
}
