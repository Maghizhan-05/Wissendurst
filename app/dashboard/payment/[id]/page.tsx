import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, Info } from "lucide-react";
import { PaymentFlow } from "@/components/payment/payment-flow";
import {
  PayPanelGuard,
  TeamEditScope,
  TeamPanel,
} from "@/components/payment/team-panel";
import { getTeamForRegistration } from "@/lib/data/teams";
import { getTeamSizePrices } from "@/lib/data/events";
import { PaymentBadge } from "@/components/ui/badge";
import { requireProfile } from "@/lib/auth";
import { getMyRegistration } from "@/lib/data/registrations";
import { resolveEventUpiId } from "@/lib/data/events";
import { upiQrDataUrl } from "@/lib/payment";
import { getDefaultEventUpiId } from "@/lib/data/payment-settings";
import { formatINR } from "@/lib/utils";
import {
  HOLD_HOURS,
  formatHoldDeadline,
  paymentBlockReason,
  timedHoldDeadline,
  type PaymentBlock,
} from "@/lib/payment-intent";

const BLOCK_COPY: Record<
  Exclude<PaymentBlock, null | "paid">,
  { title: string; body: string }
> = {
  team_member: {
    title: "Your team head pays",
    body: "This registration is part of a team. Your team head completes the payment for everyone.",
  },
  archived: {
    title: "Payments are closed",
    body: "This event has been archived, so new payments can't be submitted. Payments already under review will still be resolved by the organizers.",
  },
  cancelled: {
    title: "Registration cancelled",
    body: "This registration was cancelled. Register for the event again if you'd like to take part.",
  },
  general_registration: {
    title: "Included in General Registration",
    body: "This event is covered by General Registration, so it isn't paid individually. Complete General Registration once, then enrol in this event for free.",
  },
  expired: {
    title: "Your seat hold expired",
    body: `Unpaid registrations hold a seat for ${HOLD_HOURS} hours. Register again to renew your hold — the current price applies.`,
  },
};

export const metadata: Metadata = { title: "Payment" };

export default async function PaymentPage({
  params,
}: PageProps<"/dashboard/payment/[id]">) {
  const { id } = await params;
  const [profile, registration] = await Promise.all([
    requireProfile(),
    getMyRegistration(id),
  ]);

  if (!registration) notFound();

  const { event } = registration;
  const block = paymentBlockReason(
    registration,
    registration.state,
    Boolean(event.archived_at),
    event.general_registration_covered,
  );
  const holdUntil = timedHoldDeadline(registration.state);
  const underReview =
    registration.state?.effective_payment_status === "under_review";
  const note = `WD27 ${profile.participant_id} ${event.slug}`.slice(0, 40);
  const upiId =
    (await resolveEventUpiId(event)) ?? (await getDefaultEventUpiId());
  const qr = await upiQrDataUrl(registration.amount, note, upiId);
  const payee = process.env.NEXT_PUBLIC_UPI_PAYEE_NAME ?? "Wissendurst 27";
  // Frozen at intent creation (0019). Legacy rows have no list price stored.
  const discount = registration.offer_discount ?? 0;
  const listPrice = registration.list_price ?? registration.amount + discount;

  // Team events (0030): the head may change teammates and the team name while
  // unpaid, before any payment evidence and within the hold. The RPC re-checks.
  const isTeamHead =
    event.team_enabled &&
    Boolean(registration.team_id) &&
    registration.is_team_head;
  const [team, teamPrices] = isTeamHead
    ? await Promise.all([
        getTeamForRegistration(registration),
        getTeamSizePrices(event.id),
      ])
    : [null, []];
  const hasEvidence = Boolean(
    registration.payment_screenshot ||
    registration.transaction_id ||
    registration.duplicate_of,
  );
  const teamEditable =
    isTeamHead &&
    registration.registration_status === "pending" &&
    registration.payment_status === "unpaid" &&
    !hasEvidence &&
    Boolean(holdUntil);
  const teamLocked =
    isTeamHead &&
    !teamEditable &&
    (hasEvidence || registration.payment_status !== "unpaid");

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/dashboard/registrations"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to my events
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Complete your payment
          </h1>
          <p className="mt-1 text-sm text-muted">
            {event.title} · Participant{" "}
            <span className="font-mono text-foreground">
              {profile.participant_id}
            </span>
          </p>
        </div>
        <PaymentBadge status={registration.payment_status} />
      </div>

      {block && block !== "paid" ? (
        <div
          role="status"
          className="mt-8 rounded-2xl border border-border bg-surface p-6"
        >
          <h2 className="font-display text-lg font-semibold text-foreground">
            {BLOCK_COPY[block].title}
          </h2>
          <p className="mt-2 text-sm text-muted">{BLOCK_COPY[block].body}</p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            {block === "general_registration" && (
              <Link
                href="/general-registration"
                className="inline-flex items-center rounded-full bg-brand px-4 py-2 font-medium text-brand-contrast"
              >
                Go to General Registration
              </Link>
            )}
            {block === "expired" && (
              <Link
                href={`/events/${event.slug}`}
                className="inline-flex items-center rounded-full bg-brand px-4 py-2 font-medium text-brand-contrast"
              >
                Renew my registration
              </Link>
            )}
            <Link
              href="/dashboard/registrations"
              className="inline-flex items-center rounded-full border border-border px-4 py-2 font-medium text-foreground hover:bg-surface-2"
            >
              Back to my events
            </Link>
          </div>
        </div>
      ) : (
        <TeamEditScope>
          {(holdUntil || underReview) && (
            <p className="mt-4 inline-flex items-center gap-2 text-sm text-muted">
              <Clock className="size-4 text-brand" aria-hidden />
              {holdUntil ? (
                <>
                  Seat held until{" "}
                  <span className="font-medium text-foreground">
                    {formatHoldDeadline(holdUntil)}
                  </span>
                  . Submit your UTR before then to keep it.
                  {teamEditable && " Editing your team doesn't change this."}
                </>
              ) : (
                "Your seat stays held while the organizers review your payment."
              )}
            </p>
          )}

          {team && (
            <div className="mt-6">
              <TeamPanel
                registrationId={registration.id}
                eventId={event.id}
                teamName={team.name}
                members={team.members}
                editable={teamEditable}
                locked={teamLocked}
                teamMin={event.team_min}
                teamMax={event.team_max}
                prices={teamPrices}
                currentAmount={registration.amount}
              />
            </div>
          )}

          <PayPanelGuard>
              <div className="mt-8 grid gap-6 lg:grid-cols-2">
                {/* Pay panel */}
                <div className="rounded-2xl border border-border bg-surface p-6">
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm text-muted">Amount to pay</p>
                    <div className="text-right">
                      {discount > 0 && (
                        <p className="text-sm text-muted line-through">
                          {formatINR(listPrice)}
                        </p>
                      )}
                      <p className="font-display text-3xl font-semibold text-foreground">
                        {formatINR(registration.amount)}
                      </p>
                    </div>
                  </div>
                  {discount > 0 && (
                    <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-success/12 px-2.5 py-0.5 text-xs font-medium text-success">
                      Event offer applied — you saved {formatINR(discount)}
                    </p>
                  )}

                  <div className="mt-6 flex flex-col items-center rounded-2xl border border-border bg-white p-5">
                    <Image
                      src={qr}
                      alt="UPI payment QR code"
                      width={240}
                      height={240}
                      unoptimized
                      className="rounded-lg"
                    />
                    <p className="mt-3 text-center text-xs text-[#0b2528]">
                      Scan with any UPI app
                    </p>
                  </div>

                  <dl className="mt-5 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted">UPI ID</dt>
                      <dd className="font-mono text-foreground">{upiId}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">Payee</dt>
                      <dd className="text-foreground">{payee}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">Reference note</dt>
                      <dd className="font-mono text-xs text-foreground">
                        {note}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-5 flex items-start gap-2 rounded-xl border border-border bg-surface-2/60 p-3 text-xs text-muted">
                    <Info className="mt-0.5 size-4 shrink-0 text-brand" />
                    <p>
                      Pay the exact amount, then upload the screenshot showing the
                      transaction/UTR number. Your spot is confirmed only after an
                      organizer verifies the payment.
                    </p>
                  </div>
                </div>

                {/* Upload / verify panel */}
                <div>
                  <PaymentFlow
                    registrationId={registration.id}
                    initialStatus={registration.payment_status}
                  />
                </div>
              </div>
          </PayPanelGuard>
        </TeamEditScope>
      )}
    </div>
  );
}
