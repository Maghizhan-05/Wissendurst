import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/data/paged";
import { registrationUnitKey, type UnitRow } from "@/lib/registration-groups";
import type { EventRow } from "@/types/database";

export interface EventCollection {
  event: EventRow;
  /** True when this event has sub-events (figures are its whole subtree). */
  isContainer: boolean;
  /**
   * Confirmed registration units across this event's subtree (intents
   * excluded). Units (D-022): one solo registration or one whole team = 1.
   */
  totalRegistrations: number;
  /** Registration units whose payment is verified (approved). */
  verifiedCount: number;
  /** Payment-intent units currently holding a seat (72-hour hold or under review). */
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
  /** Paid registration units across every event. */
  totalVerified: number;
}

type Reg = UnitRow & {
  event_id: string;
  amount: number | null;
  payment_status: string;
  registration_status: string;
};

/**
 * Money is summed per row (unchanged); registration figures are sets of
 * registration-unit keys, so a team counts once and subtree roll-ups stay
 * exact (a team belongs to exactly one event).
 */
interface Metrics {
  total: Set<string>;
  verified: Set<string>;
  collected: number;
  expected: number;
  pending: Set<string>;
}

const units = (rows: Reg[]) => new Set(rows.map(registrationUnitKey));
const addAll = (into: Set<string>, from: Set<string>) => {
  for (const k of from) into.add(k);
};

/**
 * Collection tracker grouped by top-level event, rolled up through the whole
 * sub-event tree. "Collected" counts ONLY approved (verified) payments.
 */
export async function getEventCollections(): Promise<CollectionsSummary> {
  const supabase = await createClient();

  const [eventsRes, regRows, statesRes] = await Promise.all([
    supabase.from("events").select("*").order("event_date", { ascending: true }),
    fetchAllRows<Reg>("collections registrations", (from, to) =>
      supabase
        .from("registrations")
        .select(
          "id, event_id, team_id, amount, payment_status, registration_status, team:teams!team_id(member_count)",
        )
        .order("id", { ascending: true })
        .range(from, to),
    ),
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
  for (const r of regRows) {
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
      total: units(confirmed),
      verified: units(verified),
      collected,
      expected: collected + intents.reduce((s, r) => s + (r.amount ?? 0), 0),
      pending: units(intents),
    };
  };

  const memo = new Map<string, Metrics>();
  const subtree = (id: string): Metrics => {
    const cached = memo.get(id);
    if (cached) return cached;
    const m = directMetrics(regsByEvent.get(id) ?? []);
    for (const child of childrenOf.get(id) ?? []) {
      const c = subtree(child.id);
      addAll(m.total, c.total);
      addAll(m.verified, c.verified);
      m.collected += c.collected;
      m.expected += c.expected;
      addAll(m.pending, c.pending);
    }
    memo.set(id, m);
    return m;
  };

  const toCollection = (ev: EventRow): EventCollection => {
    const m = subtree(ev.id);
    return {
      event: ev,
      isContainer: (childrenOf.get(ev.id) ?? []).length > 0,
      totalRegistrations: m.total.size,
      verifiedCount: m.verified.size,
      pendingCount: m.pending.size,
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
