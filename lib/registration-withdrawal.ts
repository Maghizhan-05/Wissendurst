/**
 * D-029 withdrawal rules shared by the event page and the payment page. Pure
 * (unit-tested). Mirrors public.cancel_my_registration (0036) for
 * presentation only; the database re-checks everything under its lock
 * (including UTR claims, which the client can't see).
 */

export type WithdrawalKind = "solo" | "team_head" | "team_member";

export interface WithdrawalCandidate {
  team_id: string | null;
  is_team_head: boolean;
  registration_status: string;
  payment_status: string;
  payment_screenshot: string | null;
  transaction_id: string | null;
  duplicate_of: string | null;
}

/** Pending + unpaid + no screenshot / UTR / duplicate link. */
export function isUnpaidWithoutEvidence(r: WithdrawalCandidate): boolean {
  return (
    r.registration_status === "pending" &&
    r.payment_status === "unpaid" &&
    !r.payment_screenshot &&
    !r.transaction_id &&
    !r.duplicate_of
  );
}

/**
 * How the viewer may withdraw: "solo" / "team_head" show the control,
 * "team_member" shows guidance to ask the head, null shows nothing. A team of
 * one (teamSize 1, when known) reads as solo.
 */
export function withdrawalKind(r: WithdrawalCandidate, teamSize?: number): WithdrawalKind | null {
  if (r.team_id && !r.is_team_head) return "team_member";
  if (!isUnpaidWithoutEvidence(r)) return null;
  if (!r.team_id) return "solo";
  return teamSize === 1 ? "solo" : "team_head";
}

export const WITHDRAW_COPY: Record<"solo" | "team_head", { title: string; body: string; confirm: string }> = {
  solo: {
    title: "Withdraw your registration?",
    body: "Your unpaid registration is cancelled and your held seat is released. You can register again while registration is open; the price at that time applies.",
    confirm: "Withdraw registration",
  },
  team_head: {
    title: "Withdraw the entire team?",
    body: "This cancels the entire team’s unpaid registration — every teammate’s place is released, not only yours. Teammates can then join another team or register again.",
    confirm: "Withdraw entire team",
  },
};

export const TEAM_MEMBER_WITHDRAW_GUIDANCE =
  "Need to leave this team? Ask your team head — only they can change or withdraw the team’s registration.";
