"use client";

import { useActionState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useEffect } from "react";
import { Lock } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { registerForEvent, type ActionResult } from "@/lib/actions/registration";
import type { RegistrationRow } from "@/types/database";

export function RegisterCta({
  eventId,
  slug,
  isLoggedIn,
  isLive,
  registrationOpen,
  isFull,
  fee,
  existing,
}: {
  eventId: string;
  slug: string;
  isLoggedIn: boolean;
  isLive: boolean;
  registrationOpen: boolean;
  isFull: boolean;
  fee: number;
  existing: RegistrationRow | null;
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
    const needsPayment =
      existing.payment_status === "unpaid" ||
      existing.payment_status === "rejected" ||
      existing.payment_status === "duplicate";
    return (
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

  return (
    <form action={formAction}>
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="slug" value={slug} />
      <Button type="submit" size="lg" loading={pending} withArrow>
        {fee === 0 ? "Register — Free" : "Register for this event"}
      </Button>
    </form>
  );
}
