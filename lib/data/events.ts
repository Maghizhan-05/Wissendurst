import { createClient } from "@/lib/supabase/server";
import type { EventRow } from "@/types/database";

/**
 * Public event queries below all exclude archived events. Archived events stay
 * readable to admins (and to participants with history in them) through RLS,
 * so the explicit `archived_at is null` filter is what keeps them off public
 * pages for everyone.
 */

/** All public (non-archived) events, newest-dated first (nulls last). */
export async function getEvents(): Promise<EventRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("*")
    .is("archived_at", null)
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
    .is("archived_at", null)
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
    .is("archived_at", null)
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
    .not("parent_event_id", "is", null)
    .is("archived_at", null);
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

export interface OfferPrice {
  list: number; // paise — the event's own price
  discount: number; // paise — best qualifying Event Offer, capped at list
  amount: number; // paise — what the user would pay right now
}

export interface EventOfferPrices {
  /** Solo registration (or a team of one). */
  solo: OfferPrice;
  /** A real team (2+) registered by this user as head. */
  team: OfferPrice;
}

/**
 * Offer-aware prices for the signed-in user, computed by the same database
 * rule register_for_event / register_team use (my_offer_prices), so previews
 * always match the frozen price. Only events with a discount are returned.
 * Events the user already holds a live registration for are skipped.
 */
export async function getMyOfferPrices(
  eventIds: string[],
): Promise<Record<string, EventOfferPrices>> {
  const result: Record<string, EventOfferPrices> = {};
  if (eventIds.length === 0) return result;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return result;

  const [{ data, error }, { data: states }] = await Promise.all([
    supabase.rpc("my_offer_prices", { p_event_ids: eventIds }),
    supabase.rpc("my_registration_states"),
  ]);
  if (error) {
    console.error("my_offer_prices failed:", error);
    return result;
  }
  const live = new Set(
    ((states ?? []) as { event_id: string; reusable: boolean }[])
      .filter((st) => !st.reusable)
      .map((st) => st.event_id),
  );
  for (const r of (data ?? []) as {
    event_id: string;
    solo_list: number;
    solo_discount: number;
    solo_amount: number;
    team_list: number;
    team_discount: number;
    team_amount: number;
  }[]) {
    if (live.has(r.event_id)) continue;
    if (r.solo_discount <= 0 && r.team_discount <= 0) continue;
    result[r.event_id] = {
      solo: { list: r.solo_list, discount: r.solo_discount, amount: r.solo_amount },
      team: { list: r.team_list, discount: r.team_discount, amount: r.team_amount },
    };
  }
  return result;
}

/** Solo-price discounts (paise) keyed by event id — for event cards. */
export function soloDiscounts(
  prices: Record<string, EventOfferPrices>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, p] of Object.entries(prices)) {
    if (p.solo.discount > 0) out[id] = p.solo.discount;
  }
  return out;
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
    .is("archived_at", null)
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
    .is("archived_at", null)
    .maybeSingle();
  return (data as EventRow) ?? null;
}

/** Slugs for generateStaticParams / sitemap. */
export async function getAllEventSlugs(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("slug")
    .is("archived_at", null);
  return (data ?? []).map((r) => (r as { slug: string }).slug);
}

export interface EventCapacityCount {
  /** Confirmed registrations + live payment-intent holds (capacity use). */
  seatsTaken: number;
  /** Confirmed registrations only (intents excluded). */
  confirmed: number;
}

/**
 * Capacity use per event id, computed in the database so public visitors get
 * correct aggregate numbers without being able to read other people's rows.
 */
export async function getEventCapacityCounts(): Promise<
  Record<string, EventCapacityCount>
> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("event_capacity_counts");
  if (error) console.error("event_capacity_counts failed:", error);
  const counts: Record<string, EventCapacityCount> = {};
  for (const row of (data ?? []) as {
    event_id: string;
    seats_taken: number;
    confirmed: number;
  }[]) {
    counts[row.event_id] = {
      seatsTaken: row.seats_taken,
      confirmed: row.confirmed,
    };
  }
  return counts;
}
