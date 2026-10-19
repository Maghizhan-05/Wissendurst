"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, MapPin, ArrowUpRight, CreditCard } from "lucide-react";
import { EventThumb } from "@/components/events/category-visual";
import { PaymentBadge, RegistrationBadge } from "@/components/ui/badge";
import { cn, formatEventDate, formatINR } from "@/lib/utils";
import type { RegistrationWithEvent } from "@/types/database";

/**
 * Interactive 3D flip card. Flips on hover (desktop) and tap (mobile).
 * Front: event glance. Back: registration + payment detail.
 */
export function RegistrationFlipCard({
  registration,
}: {
  registration: RegistrationWithEvent;
}) {
  const [flipped, setFlipped] = useState(false);
  const { event } = registration;

  const isTeamMember = !!registration.team_id && !registration.is_team_head;
  const needsPayment =
    !isTeamMember &&
    (registration.payment_status === "unpaid" ||
      registration.payment_status === "rejected" ||
      registration.payment_status === "duplicate");

  return (
    <div
      className="perspective-1000 h-80"
      onMouseEnter={() => setFlipped(true)}
      onMouseLeave={() => setFlipped(false)}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={`${event.title} registration card. Activate to flip.`}
        onClick={() => setFlipped((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setFlipped((v) => !v);
          }
        }}
        className={cn(
          "preserve-3d relative h-full w-full cursor-pointer rounded-2xl transition-transform duration-500",
          flipped && "rotate-y-180",
        )}
      >
        {/* Front */}
        <div className="backface-hidden absolute inset-0 overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="relative h-36 overflow-hidden">
            <EventThumb
              src={event.thumbnail_image ?? event.hero_image}
              alt={event.title}
              category={event.category}
              sizes="(max-width: 640px) 100vw, 33vw"
            />
            <div className="absolute right-2 top-2">
              <RegistrationBadge status={registration.registration_status} />
            </div>
          </div>
          <div className="p-4">
            <h3 className="font-display text-lg font-semibold leading-snug text-foreground">
              {event.title}
            </h3>
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
              <CalendarDays className="size-3.5" />
              {formatEventDate(event.event_date)}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <PaymentBadge status={registration.payment_status} />
              <span className="text-xs text-muted">Hover / tap to flip</span>
            </div>
          </div>
        </div>

        {/* Back */}
        <div className="backface-hidden rotate-y-180 absolute inset-0 flex flex-col rounded-2xl border border-brand/30 bg-surface p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-brand">
            Registration
          </p>
          <p className="mt-1 font-mono text-sm text-foreground">
            {registration.id.slice(0, 8).toUpperCase()}
          </p>

          <dl className="mt-4 space-y-2.5 text-sm">
            <Row label="Payment">
              <PaymentBadge status={registration.payment_status} />
            </Row>
            <Row label="Amount">
              <span className="font-mono text-foreground">
                {registration.amount === 0 ? "Free" : formatINR(registration.amount)}
              </span>
            </Row>
            {registration.team_id && (
              <Row label="Team">
                <span className="text-foreground">
                  {registration.is_team_head ? "Team head" : "Team member"}
                </span>
              </Row>
            )}
            <Row label="Registered">
              <span className="text-foreground">
                {formatEventDate(registration.registered_at.slice(0, 10))}
              </span>
            </Row>
            {event.venue && (
              <Row label="Venue">
                <span className="inline-flex items-center gap-1 text-foreground">
                  <MapPin className="size-3.5" /> {event.venue}
                </span>
              </Row>
            )}
          </dl>

          <div className="mt-auto flex gap-2 pt-4">
            {needsPayment && (
              <Link
                href={`/dashboard/payment/${registration.id}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-brand px-3 py-2 text-xs font-medium text-brand-contrast"
              >
                <CreditCard className="size-3.5" /> Pay now
              </Link>
            )}
            <Link
              href={`/events/${event.slug}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-full border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-2"
            >
              View event <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
