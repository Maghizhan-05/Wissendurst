"use client";

import { useActionState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useEffect } from "react";
import { Clock, Lock, Ticket, Users } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { registerForEvent, type ActionResult } from "@/lib/actions/registration";
import { TeamRegister } from "@/components/events/team-register";
import type { TeamSizePriceView } from "@/components/events/team-builder";
import { formatINR } from "@/lib/utils";
import {
  HOLD_HOURS,
  formatHoldDeadline,
  timedHoldDeadline,
  type RegistrationState,
} from "@/lib/payment-intent";
import type { RegistrationRow } from "@/types/database";

type TeamHead = {
  id: string;
  participant_id: string;
  full_name: string;
  email: string;
  college: string | null;
};

type RegisterCtaProps = Parameters<typeof RegisterCtaBody>[0] & {
  /** The user's previous payment intent expired and can be renewed. */
  expiredIntent?: boolean;
};

export function RegisterCta({ expiredIntent = false, ...props }: RegisterCtaProps) {
  if (!expiredIntent || props.existing) return <RegisterCtaBody {...props} />;
  return (
    <div className="flex flex-col gap-3">
      <p
        role="status"
        className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground"
      >
        Your previous {HOLD_HOURS}-hour seat hold expired before payment was
        submitted. Register again to renew it — the current price applies.
      </p>
      <RegisterCtaBody {...props} />
    </div>
  );
}

function RegisterCtaBody({
  eventId,
  slug,
  isLoggedIn,
  isLive,
  registrationOpen,
  isFull,
  fee,
  discountPaise = 0,
  existing,
  teamEnabled = false,
  teamMin = 2,
  teamMax = 4,
  teamPrices = [],
  head = null,
  generalRegistrationCovered = false,
  generallyRegistered = false,
}: {
  /** Event is included in General Registration (0023). */
  generalRegistrationCovered?: boolean;
  /** The signed-in participant's General Registration is verified. */
  generallyRegistered?: boolean;
  eventId: string;
  slug: string;
  isLoggedIn: boolean;
  isLive: boolean;
  registrationOpen: boolean;
  isFull: boolean;
  fee: number;
  /** Event Offer discount on the solo price (paise). */
  discountPaise?: number;
  /** A live registration (cancelled rows / expired intents are passed as null). */
  existing: (RegistrationRow & { state?: RegistrationState | null }) | null;
  teamEnabled?: boolean;
  teamMin?: number;
  teamMax?: number;
  /** Price of every team size 1..teamMax for this user (offers applied). */
  teamPrices?: TeamSizePriceView[];
  head?: TeamHead | null;
}) {
  const [state, formAction, pending] = useActionState(
    async (_prev: ActionResult | null, formData: FormData) =>
      registerForEvent(formData),
    null,
  );

  useEffect(() => {
    if (state && !state.ok) toast.error(state.error);
  }, [state]);

  if (existing) {
    // A teammate (not the head) doesn't pay — the head covers the team.
    if (existing.team_id && !existing.is_team_head) {
      return (
        <div className="flex flex-col gap-3">
          <div className="inline-flex items-center gap-2.5 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground">
            <Users className="size-4 text-brand" />
            {existing.registration_status === "confirmed"
              ? "You're on a confirmed team for this event."
              : "You're on a team for this event — your team head completes the payment. It appears in My events once the payment is verified."}
          </div>
          <ButtonLink
            href={existing.registration_status === "confirmed" ? "/dashboard/registrations" : "/events"}
            size="lg"
            variant="outline"
          >
            {existing.registration_status === "confirmed" ? "View my events" : "Browse more"}
          </ButtonLink>
        </div>
      );
    }
    const needsPayment =
      existing.payment_status === "unpaid" ||
      existing.payment_status === "uploaded" ||
      existing.payment_status === "rejected" ||
      existing.payment_status === "duplicate";
    const holdUntil = timedHoldDeadline(existing.state ?? null);
    return (
      <div className="flex flex-col gap-3">
        {holdUntil && (
          <p className="inline-flex items-center gap-2 text-sm text-muted">
            <Clock className="size-4 text-brand" aria-hidden />
            Your seat is held until{" "}
            <span className="font-medium text-foreground">
              {formatHoldDeadline(holdUntil)}
            </span>{" "}
            — pay and submit your UTR before then.
          </p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          <ButtonLink
            href={
              existing.registration_status === "confirmed"
                ? "/dashboard/registrations"
                : `/dashboard/payment/${existing.id}`
            }
            size="lg"
            withArrow
          >
            {existing.registration_status === "confirmed"
              ? "View Registration"
              : existing.payment_status === "rejected"
                ? "Submit new payment evidence"
                : needsPayment
                  ? "Complete Payment"
                  : "View payment status"}
          </ButtonLink>
          <ButtonLink href="/events" size="lg" variant="outline">
            Browse more
          </ButtonLink>
        </div>
      </div>
    );
  }

  if (!isLive) {
    return (
      <div className="inline-flex items-center gap-2.5 rounded-full border border-border bg-surface px-5 py-3.5 text-sm font-medium text-muted">
        <Lock className="size-4 text-brand" />
        Coming soon — registration opens soon
      </div>
    );
  }

  if (!registrationOpen) {
    return (
      <Button size="lg" variant="secondary" disabled>
        Registration Closed
      </Button>
    );
  }

  if (isFull) {
    return (
      <Button size="lg" variant="secondary" disabled>
        Event Full
      </Button>
    );
  }

  // Covered events are never paid individually: participants without a
  // verified General Registration are sent there instead of the payment path.
  if (generalRegistrationCovered && !generallyRegistered) {
    return (
      <section
        aria-labelledby={`gr-note-${eventId}`}
        className="flex flex-col gap-3 rounded-2xl border border-brand/30 bg-brand/5 p-5"
      >
        <h2 id={`gr-note-${eventId}`} className="flex items-center gap-2 font-medium text-foreground">
          <Ticket className="size-4 text-brand" aria-hidden /> Included in General Registration
        </h2>
        <p className="text-sm text-muted">
          This event isn&rsquo;t paid for individually. Complete General Registration once
          {teamEnabled ? " (every team member needs it)" : ""}, then come back and enrol here for free.
        </p>
        <ButtonLink
          href={isLoggedIn ? "/general-registration" : "/login?next=/general-registration"}
          size="lg"
          withArrow
          className="self-start"
        >
          {isLoggedIn ? "Go to General Registration" : "Login for General Registration"}
        </ButtonLink>
      </section>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row">
        <ButtonLink href={`/login?next=/events/${slug}`} size="lg" withArrow>
          Login to Register
        </ButtonLink>
        <span className="self-center text-sm text-muted">
          New here?{" "}
          <Link href="/signup" className="font-medium text-brand hover:underline">
            Create an account
          </Link>
        </span>
      </div>
    );
  }

  const grNote = generalRegistrationCovered ? (
    <p className="inline-flex items-center gap-2 text-sm text-success">
      <Ticket className="size-4" aria-hidden /> Included in your General Registration — enrolment is free.
    </p>
  ) : null;

  if (teamEnabled && head) {
    return (
      <div className="flex flex-col gap-3">
      {grNote}
      <TeamRegister
        eventId={eventId}
        slug={slug}
        prices={teamPrices}
        teamMin={teamMin}
        teamMax={teamMax}
        head={head}
      />
      </div>
    );
  }

  const discounted = discountPaise > 0 && fee > 0;
  const finalFee = Math.max(fee - discountPaise, 0);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="slug" value={slug} />
      {grNote}
      {discounted && !generalRegistrationCovered && (
        <div className="inline-flex flex-wrap items-center gap-2.5 rounded-xl border border-success/30 bg-success/10 px-4 py-2.5 text-sm">
          <span className="text-muted line-through">{formatINR(fee)}</span>
          <span className="font-display text-lg font-semibold text-foreground">
            {finalFee === 0 ? "Free" : formatINR(finalFee)}
          </span>
          <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
            You save {formatINR(discountPaise)}
          </span>
        </div>
      )}
      <Button type="submit" size="lg" loading={pending} withArrow className="self-start">
        {generalRegistrationCovered
          ? "Enrol — included"
          : fee === 0
          ? "Register — Free"
          : discounted
            ? `Register — pay ${formatINR(finalFee)}`
            : "Register for this event"}
      </Button>
    </form>
  );
}
