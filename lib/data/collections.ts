import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { EventRow } from "@/types/database";

export interface EventCollection {
  event: EventRow;
  /** True when this event has sub-events (figures are its whole subtree). */
  isContainer: boolean;
  /** Confirmed registrations across this event's subtree (intents excluded). */
  totalRegistrations: number;
  /** Registrations whose payment is verified (approved). */
  verifiedCount: number;
  /** Payment intents currently holding a seat (72-hour hold or under review). */
  pendingCount: number;
  /** Money collected = sum of amounts on VERIFIED payments in the subtree. */
  collectedPaise: number;
  /** Collected + amounts of intents still holding a seat (bar's 100%). */
  expectedPaise: number;
  /** collected / expected, clamped 0–100. */
  progress: number;
}

/**
 * A top-level event with its collection figures (subtree roll-up) and, when it
 * is a broader event, each direct sub-event broken out — itself a subtree sum,
 * so three-tier trees still read at the event and sub-event level.
 */
export interface CollectionGroup extends EventCollection {
  children: EventCollection[];
}

export interface CollectionsSummary {
  groups: CollectionGroup[];
  totalCollectedPaise: number;
  totalExpectedPaise: number;
  totalVerified: number;
}

type Reg = {
  id: string;
  event_id: string;
  amount: number | null;
  payment_status: string;
  registration_status: string;
};

interface Metrics {
  total: number;
  verified: number;
  collected: number;
  expected: number;
  pending: number;
}

/**
 * Collection tracker grouped by top-level event, rolled up through the whole
 * sub-event tree. "Collected" counts ONLY approved (verified) payments.
 */
export async function getEventCollections(): Promise<CollectionsSummary> {
  const supabase = await createClient();

  const [eventsRes, regsRes, statesRes] = await Promise.all([
    supabase.from("events").select("*").order("event_date", { ascending: true }),
    supabase
      .from("registrations")
      .select("id, event_id, amount, payment_status, registration_status"),
    supabase.rpc("admin_registration_states"),
  ]);
  if (statesRes.error)
    console.error("admin_registration_states failed:", statesRes.error);
  const holdsSeat = new Set(
    ((statesRes.data ?? []) as { registration_id: string; holds_seat: boolean }[])
      .filter((s) => s.holds_seat)
      .map((s) => s.registration_id),
  );

  const regsByEvent = new Map<string, Reg[]>();
  for (const r of (regsRes.data ?? []) as Reg[]) {
    const arr = regsByEvent.get(r.event_id) ?? [];
    arr.push(r);
    regsByEvent.set(r.event_id, arr);
  }

  const allEvents = (eventsRes.data ?? []) as EventRow[];
  const childrenOf = new Map<string, EventRow[]>();
  for (const ev of allEvents) {
    if (ev.parent_event_id) {
      const arr = childrenOf.get(ev.parent_event_id) ?? [];
      arr.push(ev);
      childrenOf.set(ev.parent_event_id, arr);
    }
  }

  const directMetrics = (rows: Reg[]): Metrics => {
    const confirmed = rows.filter((r) => r.registration_status === "confirmed");
    const verified = rows.filter((r) => r.payment_status === "verified");
    const intents = rows.filter(
      (r) => r.registration_status === "pending" && holdsSeat.has(r.id),
    );
    const collected = verified.reduce((s, r) => s + (r.amount ?? 0), 0);
    return {
      total: confirmed.length,
      verified: verified.length,
      collected,
      expected: collected + intents.reduce((s, r) => s + (r.amount ?? 0), 0),
      pending: intents.length,
    };
  };

  const memo = new Map<string, Metrics>();
  const subtree = (id: string): Metrics => {
    const cached = memo.get(id);
    if (cached) return cached;
    const m = directMetrics(regsByEvent.get(id) ?? []);
    for (const child of childrenOf.get(id) ?? []) {
      const c = subtree(child.id);
      m.total += c.total;
      m.verified += c.verified;
      m.collected += c.collected;
      m.expected += c.expected;
      m.pending += c.pending;
    }
    memo.set(id, m);
    return m;
  };

  const toCollection = (ev: EventRow): EventCollection => {
    const m = subtree(ev.id);
    return {
      event: ev,
      isContainer: (childrenOf.get(ev.id) ?? []).length > 0,
      totalRegistrations: m.total,
      verifiedCount: m.verified,
      pendingCount: m.pending,
      collectedPaise: m.collected,
      expectedPaise: m.expected,
      progress:
        m.expected > 0 ? Math.min(100, (m.collected / m.expected) * 100) : 0,
    };
  };

  const groups: CollectionGroup[] = allEvents
    .filter((ev) => ev.parent_event_id === null)
    .map((root) => ({
      ...toCollection(root),
      children: (childrenOf.get(root.id) ?? []).map(toCollection),
    }));

  groups.sort((a, b) => b.collectedPaise - a.collectedPaise);

  return {
    groups,
    totalCollectedPaise: groups.reduce((s, g) => s + g.collectedPaise, 0),
    totalExpectedPaise: groups.reduce((s, g) => s + g.expectedPaise, 0),
    totalVerified: groups.reduce((s, g) => s + g.verifiedCount, 0),
  };
}
