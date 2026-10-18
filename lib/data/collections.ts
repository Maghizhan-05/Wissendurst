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

export interface CollectionsSummary {
  events: EventCollection[];
  totalCollectedPaise: number;
  totalExpectedPaise: number;
  totalVerified: number;
}

/**
 * Per-event collection tracker. "Collected" counts ONLY approved (verified)
 * payments — pending/under-review/unpaid amounts are excluded, and form the
 * remaining gap up to the expected total from current registrants.
 */
export async function getEventCollections(): Promise<CollectionsSummary> {
  const supabase = await createClient();

  const [eventsRes, regsRes] = await Promise.all([
    supabase.from("events").select("*").order("event_date", { ascending: true }),
    supabase
      .from("registrations")
      .select("event_id, amount, payment_status, registration_status"),
  ]);

  type Reg = {
    event_id: string;
    amount: number | null;
    payment_status: string;
    registration_status: string;
  };

  const byEvent = new Map<string, Reg[]>();
  for (const r of (regsRes.data ?? []) as Reg[]) {
    const arr = byEvent.get(r.event_id) ?? [];
    arr.push(r);
    byEvent.set(r.event_id, arr);
  }

  const events: EventCollection[] = ((eventsRes.data ?? []) as EventRow[]).map(
    (ev) => {
      const rows = (byEvent.get(ev.id) ?? []).filter(
        (r) => r.registration_status !== "cancelled",
      );
      const verified = rows.filter((r) => r.payment_status === "verified");
      const collectedPaise = verified.reduce((s, r) => s + (r.amount ?? 0), 0);
      const expectedPaise = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
      const progress =
        expectedPaise > 0
          ? Math.min(100, (collectedPaise / expectedPaise) * 100)
          : 0;
      return {
        event: ev,
        totalRegistrations: rows.length,
        verifiedCount: verified.length,
        pendingCount: rows.length - verified.length,
        collectedPaise,
        expectedPaise,
        progress,
      };
    },
  );

  // Highest-earning events first; events with no money fall to the bottom.
  events.sort((a, b) => b.collectedPaise - a.collectedPaise);

  return {
    events,
    totalCollectedPaise: events.reduce((s, c) => s + c.collectedPaise, 0),
    totalExpectedPaise: events.reduce((s, c) => s + c.expectedPaise, 0),
    totalVerified: events.reduce((s, c) => s + c.verifiedCount, 0),
  };
}
