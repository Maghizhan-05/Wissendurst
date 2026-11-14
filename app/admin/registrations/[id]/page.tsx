import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import { PaymentBadge, RegistrationBadge } from "@/components/ui/badge";
import { getRegistrationContact, type ContactPerson } from "@/lib/data/event-admin";
import { canOnEvent, requireEventArea } from "@/lib/auth";
import { formatEventDate } from "@/lib/utils";
import { teamLabel } from "@/lib/team-label";

export const metadata: Metadata = { title: "Admin · Registration" };

/**
 * Contact-focused registration detail (0034): who registered and how to reach
 * them — the participant, or every confirmed member of the team. Payment
 * evidence (UTR, screenshot, amount, OCR) lives only on the payment review
 * page, linked here just for accounts with the payments permission.
 */
export default async function RegistrationDetailPage({
  params,
}: PageProps<"/admin/registrations/[id]">) {
  const access = await requireEventArea("events");
  const { id } = await params;
  const reg = await getRegistrationContact(id);
  // Unknown, unconfirmed, or another event's registration: indistinguishable.
  if (!reg || !canOnEvent(access, reg.eventId, "events")) notFound();
  const canReviewPayment = canOnEvent(access, reg.eventId, "payments");

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={`/admin/registrations?event=${reg.eventId}`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to registrations
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            {reg.team ? teamLabel(reg.team.name) : reg.people[0]?.fullName}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {reg.team?.code ? <span className="font-mono text-brand">{reg.team.code}</span> : null}
            {reg.team?.code ? " · " : ""}
            {reg.event.title}
            {reg.event.event_date ? ` · ${formatEventDate(reg.event.event_date)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RegistrationBadge status={reg.registrationStatus} />
          <PaymentBadge status={reg.paymentStatus} />
        </div>
      </div>

      <dl className="mt-6 grid gap-4 rounded-2xl border border-border bg-surface p-5 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted">Registered</dt>
          <dd className="mt-0.5 text-foreground">{formatEventDate(reg.registeredAt.slice(0, 10))}</dd>
        </div>
        <div>
          <dt className="text-muted">Registration</dt>
          <dd className="mt-0.5 text-foreground">
            {reg.team ? `Team of ${reg.people.length}` : "Single"}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Event</dt>
          <dd className="mt-0.5 text-foreground">{reg.event.title}</dd>
        </div>
      </dl>

      <section aria-labelledby="contacts" className="mt-6 space-y-3">
        <h2 id="contacts" className="font-display text-lg font-semibold text-foreground">
          {reg.team ? "Team members" : "Participant"}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {reg.people.map((p) => (
            <PersonCard key={p.registrationId} person={p} showRole={Boolean(reg.team)} />
          ))}
        </ul>
      </section>

      {canReviewPayment && (
        <p className="mt-6 text-sm text-muted">
          Payment evidence is kept separately on the{" "}
          <Link href={`/admin/payments/${reg.id}`} className="font-medium text-brand hover:underline">
            payment review page
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function PersonCard({ person: p, showRole }: { person: ContactPerson; showRole: boolean }) {
  const study = [p.course, p.year].filter(Boolean).join(" · ");
  return (
    <li className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs text-brand">{p.participantId ?? "—"}</p>
          <p className="truncate font-medium text-foreground">{p.fullName}</p>
        </div>
        {showRole && (
          <span className="shrink-0 text-xs text-muted">{p.isTeamHead ? "Team head" : "Member"}</span>
        )}
      </div>
      <dl className="mt-3 space-y-1.5 text-sm">
        <div>
          <dt className="sr-only">Email</dt>
          <dd className="flex min-w-0 items-center gap-2 break-all">
            <Mail className="size-3.5 shrink-0 text-muted" aria-hidden />
            {p.email ? (
              <a href={`mailto:${p.email}`} className="text-foreground hover:text-brand">
                {p.email}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt className="sr-only">Phone</dt>
          <dd className="flex items-center gap-2">
            <Phone className="size-3.5 shrink-0 text-muted" aria-hidden />
            {p.phone ? (
              <a href={`tel:${p.phone.replace(/[^+\d]/g, "")}`} className="text-foreground hover:text-brand">
                {p.phone}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        {(p.college || study) && (
          <div className="text-muted">
            <dt className="sr-only">College</dt>
            <dd>{[p.college, study].filter(Boolean).join(" · ")}</dd>
          </div>
        )}
      </dl>
    </li>
  );
}
