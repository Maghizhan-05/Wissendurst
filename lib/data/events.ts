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
