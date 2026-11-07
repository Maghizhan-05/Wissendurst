import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, Ticket } from "lucide-react";
import { ParticipantIdCard } from "@/components/dashboard/participant-id-card";
import { RegistrationFlipCard } from "@/components/dashboard/registration-flip-card";
import { StatCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { requireProfile } from "@/lib/auth";
import { getMyRegistrations } from "@/lib/data/registrations";
import { teamDisplay } from "@/lib/team-label";
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

  // Confirmed registrations only (getMyRegistrations); unpaid intents and
  // payments under review are reached from the event or payment page.
  const teams = registrations.filter((r) => teamDisplay(r.team) !== null).length;

  const recent = registrations.slice(0, 3);

  return (
    <div className="space-y-10">
      {showGr && <GeneralRegistrationCard gr={gr} fee={grSettings.fee} />}
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1.4fr]">
        <ParticipantIdCard profile={profile} />
        <div className="grid grid-cols-2 gap-4">
          <StatCard label="Registered events" value={registrations.length} tone="brand" />
          <StatCard label="As part of a team" value={teams} tone="success" />
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

      <div className="hidden gap-4 sm:flex">
        <span className="inline-flex items-center gap-2 text-sm text-muted">
          <CalendarCheck className="size-4 text-success" /> Events appear here once your spot is
          confirmed — free events straight away, paid events after your payment is verified.
        </span>
      </div>
    </div>
  );
}
