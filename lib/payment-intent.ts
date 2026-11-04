/**
 * Payment-intent rules shared by server and client code. The database
 * (0017_payment_intents) is the source of truth; these helpers only mirror it
 * for presentation and early, friendly errors.
 */
import type { PaymentStatus, RegistrationStatus } from "@/lib/constants";
import type { RegistrationRow } from "@/types/database";

/** How long an unpaid / screenshot-only intent holds a seat. */
export const HOLD_HOURS = 72;

/** Statuses whose seat hold expires after HOLD_HOURS. */
export const TIMED_HOLD_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "unpaid",
  "uploaded",
  "duplicate",
];

/** Effective intent state of one registration (my_registration_states). */
export interface RegistrationState {
  registration_id: string;
  event_id: string;
  holds_seat: boolean;
  expired_intent: boolean;
  /** Cancelled or expired: registering again refreshes this row. */
  reusable: boolean;
  effective_registration_status: RegistrationStatus;
  effective_payment_status: PaymentStatus;
  effective_hold_expires_at: string | null;
}

export type PaymentBlock =
  | "team_member"
  | "archived"
  | "cancelled"
  | "paid"
  | "expired"
  | "general_registration"
  | null;

/** Why the participant can't submit a payment right now (null = allowed). */
export function paymentBlockReason(
  reg: Pick<
    RegistrationRow,
    "team_id" | "is_team_head" | "registration_status" | "payment_status"
  >,
  state: Pick<RegistrationState, "expired_intent"> | null,
  eventArchived: boolean,
  /** Event is included in General Registration (0023): never paid individually. */
  generalRegistrationCovered = false,
): PaymentBlock {
  if (reg.team_id && !reg.is_team_head) return "team_member";
  if (eventArchived) return "archived";
  if (reg.registration_status === "cancelled") return "cancelled";
  if (reg.registration_status === "confirmed" || reg.payment_status === "verified")
    return "paid";
  if (generalRegistrationCovered) return "general_registration";
  if (state?.expired_intent) return "expired";
  return null;
}

/** Deadline of a live timed hold, or null when the hold isn't time-limited. */
export function timedHoldDeadline(
  state: Pick<
    RegistrationState,
    | "effective_registration_status"
    | "effective_payment_status"
    | "effective_hold_expires_at"
    | "holds_seat"
  > | null,
): Date | null {
  if (!state || !state.holds_seat) return null;
  if (state.effective_registration_status !== "pending") return null;
  if (!TIMED_HOLD_PAYMENT_STATUSES.includes(state.effective_payment_status))
    return null;
  return state.effective_hold_expires_at
    ? new Date(state.effective_hold_expires_at)
    : null;
}

/** "Fri, 7 Nov, 3:40 pm" in IST — the event's audience is in India. */
export function formatHoldDeadline(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(d);
}
