import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { EventRow } from "@/types/database";

export interface EventCollection {
  event: EventRow;
  /** True when this event has sub-events (figures are its whole subtree). */
  isContainer: boolean;
  /** Non-cancelled registrations across this event's subtree. */
  totalRegistrations: number;
  /** Registrations whose payment is verified (approved). */
  verifiedCount: number;
  /** Registrations still awaiting a verified payment (non-cancelled). */
  pendingCount: number;
  /** Money collected = sum of amounts on VERIFIED payments in the subtree. */
  collectedPaise: number;
  /** Money owed by everyone currently registered in the subtree (bar's 100%). */
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
}

/**
 * Collection tracker grouped by top-level event, rolled up through the whole
 * sub-event tree. "Collected" counts ONLY approved (verified) payments.
 */
export async function getEventCollections(): Promise<CollectionsSummary> {
  const supabase = await createClient();

  const [eventsRes, regsRes] = await Promise.all([
    supabase.from("events").select("*").order("event_date", { ascending: true }),
    supabase
      .from("registrations")
      .select("event_id, amount, payment_status, registration_status"),
  ]);

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
    const active = rows.filter((r) => r.registration_status !== "cancelled");
    const verified = active.filter((r) => r.payment_status === "verified");
    return {
      total: active.length,
      verified: verified.length,
      collected: verified.reduce((s, r) => s + (r.amount ?? 0), 0),
      expected: active.reduce((s, r) => s + (r.amount ?? 0), 0),
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
      pendingCount: m.total - m.verified,
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
