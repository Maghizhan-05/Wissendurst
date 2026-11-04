"use client";

import { useActionState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useEffect } from "react";
import { Clock, Lock, Users } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { registerForEvent, type ActionResult } from "@/lib/actions/registration";
import { TeamRegister } from "@/components/events/team-register";
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
  teamDiscountPaise = 0,
  existing,
  teamEnabled = false,
  teamMin = 2,
  teamMax = 4,
  teamFee = 0,
  head = null,
}: {
  eventId: string;
  slug: string;
  isLoggedIn: boolean;
  isLive: boolean;
  registrationOpen: boolean;
  isFull: boolean;
  fee: number;
  /** Event Offer discount on the solo price (paise). */
  discountPaise?: number;
  /** Event Offer discount on the team price when this user heads a team. */
  teamDiscountPaise?: number;
  /** A live registration (cancelled rows / expired intents are passed as null). */
  existing: (RegistrationRow & { state?: RegistrationState | null }) | null;
  teamEnabled?: boolean;
  teamMin?: number;
  teamMax?: number;
  teamFee?: number;
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
            You&rsquo;re on a team for this event — your team head completes the
            payment.
          </div>
          <ButtonLink href="/dashboard/registrations" size="lg" variant="outline">
            View my events
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
              needsPayment
                ? `/dashboard/payment/${existing.id}`
                : "/dashboard/registrations"
            }
            size="lg"
            withArrow
          >
            {needsPayment ? "Complete Payment" : "View Registration"}
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

  if (teamEnabled && head) {
    return (
      <TeamRegister
        eventId={eventId}
        slug={slug}
        fee={fee}
        teamFee={teamFee}
        soloDiscountPaise={discountPaise}
        teamDiscountPaise={teamDiscountPaise}
        teamMin={teamMin}
        teamMax={teamMax}
        head={head}
      />
    );
  }

  const discounted = discountPaise > 0 && fee > 0;
  const finalFee = Math.max(fee - discountPaise, 0);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="slug" value={slug} />
      {discounted && (
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
        {fee === 0
          ? "Register — Free"
          : discounted
            ? `Register — pay ${formatINR(finalFee)}`
            : "Register for this event"}
      </Button>
    </form>
  );
}
