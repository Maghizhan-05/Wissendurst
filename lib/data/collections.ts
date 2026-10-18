import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { EventRow } from "@/types/database";

export interface EventCollection {
  event: EventRow;
  /** Non-cancelled registrations for this event. */
  totalRegistrations: number;
  /** Registrations whose payment is verified (approved). */
  verifiedCount: number;
  /** Registrations still awaiting a verified payment (non-cancelled). */
  pendingCount: number;
  /** Money actually collected = sum of amounts on VERIFIED payments only. */
  collectedPaise: number;
  /** Money owed by everyone currently registered (the bar's 100%). */
  expectedPaise: number;
  /** collected / expected, clamped 0–100. */
  progress: number;
}

/**
 * A top-level event and its collection figures. When the event is a broader
 * event (a container), `children` holds its sub-event collections and the
 * top-level figures are the roll-up (sum) of those. For a standalone event,
 * `children` is empty and the figures are its own.
 */
export interface CollectionGroup extends EventCollection {
  isContainer: boolean;
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

function collectionFor(event: EventRow, rows: Reg[]): EventCollection {
  const active = rows.filter((r) => r.registration_status !== "cancelled");
  const verified = active.filter((r) => r.payment_status === "verified");
  const collectedPaise = verified.reduce((s, r) => s + (r.amount ?? 0), 0);
  const expectedPaise = active.reduce((s, r) => s + (r.amount ?? 0), 0);
  const progress =
    expectedPaise > 0
      ? Math.min(100, (collectedPaise / expectedPaise) * 100)
      : 0;
  return {
    event,
    totalRegistrations: active.length,
    verifiedCount: verified.length,
    pendingCount: active.length - verified.length,
    collectedPaise,
    expectedPaise,
    progress,
  };
}

function aggregate(
  parent: EventRow,
  children: EventCollection[],
  isContainer: boolean,
): CollectionGroup {
  const collectedPaise = children.reduce((s, c) => s + c.collectedPaise, 0);
  const expectedPaise = children.reduce((s, c) => s + c.expectedPaise, 0);
  return {
    event: parent,
    isContainer,
    children: isContainer ? children : [],
    totalRegistrations: children.reduce((s, c) => s + c.totalRegistrations, 0),
    verifiedCount: children.reduce((s, c) => s + c.verifiedCount, 0),
    pendingCount: children.reduce((s, c) => s + c.pendingCount, 0),
    collectedPaise,
    expectedPaise,
    progress:
      expectedPaise > 0
        ? Math.min(100, (collectedPaise / expectedPaise) * 100)
        : 0,
  };
}

/**
 * Collection tracker grouped by top-level event, with sub-event roll-up.
 * "Collected" counts ONLY approved (verified) payments — pending/under-review/
 * unpaid amounts form the remaining gap up to the expected total.
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
  const childrenByParent = new Map<string, EventRow[]>();
  for (const ev of allEvents) {
    if (ev.parent_event_id) {
      const arr = childrenByParent.get(ev.parent_event_id) ?? [];
      arr.push(ev);
      childrenByParent.set(ev.parent_event_id, arr);
    }
  }

  const groups: CollectionGroup[] = allEvents
    .filter((ev) => ev.parent_event_id === null)
    .map((parent) => {
      const kids = childrenByParent.get(parent.id);
      if (kids && kids.length > 0) {
        const children = kids.map((k) =>
          collectionFor(k, regsByEvent.get(k.id) ?? []),
        );
        return aggregate(parent, children, true);
      }
      // Standalone event: aggregate over just itself.
      const self = collectionFor(parent, regsByEvent.get(parent.id) ?? []);
      return aggregate(parent, [self], false);
    });

  // Highest-earning first; events with no money fall to the bottom.
  groups.sort((a, b) => b.collectedPaise - a.collectedPaise);

  return {
    groups,
    totalCollectedPaise: groups.reduce((s, g) => s + g.collectedPaise, 0),
    totalExpectedPaise: groups.reduce((s, g) => s + g.expectedPaise, 0),
    totalVerified: groups.reduce((s, g) => s + g.verifiedCount, 0),
  };
}
