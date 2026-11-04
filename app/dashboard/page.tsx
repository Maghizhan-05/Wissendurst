import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, Clock, CircleAlert, Ticket } from "lucide-react";
import { ParticipantIdCard } from "@/components/dashboard/participant-id-card";
import { RegistrationFlipCard } from "@/components/dashboard/registration-flip-card";
import { StatCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { requireProfile } from "@/lib/auth";
import { getMyRegistrations } from "@/lib/data/registrations";
import { formatINR } from "@/lib/utils";
import { GeneralRegistrationCard } from "@/components/general-registration/dashboard-card";
import {
  getGeneralRegistrationSettings,
  getMyGeneralRegistration,
  isGeneralRegistrationOpen,
} from "@/lib/data/general-registration";
import { canTakeGeneralRegistration } from "@/lib/general-registration";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const profile = await requireProfile();
  const [registrations, gr, grSettings] = await Promise.all([
    getMyRegistrations(),
    getMyGeneralRegistration(),
    getGeneralRegistrationSettings(),
  ]);
  const showGr =
    Boolean(gr) ||
    (isGeneralRegistrationOpen(grSettings) &&
      canTakeGeneralRegistration(profile.participant_id, profile.approval_status));

  const confirmed = registrations.filter(
    (r) => r.registration_status === "confirmed",
  ).length;
  const pendingPayment = registrations.filter((r) =>
    ["unpaid", "uploaded", "under_review", "rejected", "duplicate"].includes(
      r.payment_status,
    ),
  ).length;
  const amountDue = registrations
    .filter((r) => ["unpaid", "rejected", "duplicate"].includes(r.payment_status))
    .reduce((sum, r) => sum + r.amount, 0);

  const recent = registrations.slice(0, 3);

  return (
    <div className="space-y-10">
      {showGr && <GeneralRegistrationCard gr={gr} fee={grSettings.fee} />}
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1.4fr]">
        <ParticipantIdCard profile={profile} />
        <div className="grid grid-cols-2 gap-4">
          <StatCard label="Registrations" value={registrations.length} tone="brand" />
          <StatCard label="Confirmed" value={confirmed} tone="success" />
          <StatCard label="Awaiting payment" value={pendingPayment} tone="warning" />
          <StatCard
            label="Amount due"
            value={amountDue === 0 ? "—" : formatINR(amountDue)}
            tone={amountDue > 0 ? "alert" : "neutral"}
          />
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-foreground">
            Recent registrations
          </h2>
          {registrations.length > 0 && (
            <Link
              href="/dashboard/registrations"
              className="text-sm font-medium text-brand hover:underline"
            >
              View all →
            </Link>
          )}
        </div>

        {registrations.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              icon={<Ticket className="size-8" />}
              title="No registrations yet"
              description="Browse the programme and register for your first event."
              action={
                <ButtonLink href="/events" withArrow>
                  Explore Events
                </ButtonLink>
              }
            />
          </div>
        ) : (
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((r) => (
              <RegistrationFlipCard key={r.id} registration={r} />
            ))}
          </div>
        )}
      </section>

      {amountDue > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-5">
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="text-sm">
            <p className="font-medium text-foreground">
              You have {formatINR(amountDue)} in unpaid registrations.
            </p>
            <p className="mt-1 text-muted">
              Complete payment and upload your screenshot so organizers can verify
              your spot.
            </p>
          </div>
        </div>
      )}

      <div className="hidden gap-4 sm:flex">
        <span className="inline-flex items-center gap-2 text-sm text-muted">
          <CalendarCheck className="size-4 text-success" /> Confirmed = spot secured
        </span>
        <span className="inline-flex items-center gap-2 text-sm text-muted">
          <Clock className="size-4 text-warning" /> Under review = awaiting organizer
        </span>
      </div>
    </div>
  );
}
