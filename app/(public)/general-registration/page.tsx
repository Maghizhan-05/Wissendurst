import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BadgeCheck, CircleAlert, Info, TriangleAlert } from "lucide-react";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { ButtonLink } from "@/components/ui/button";
import { PaymentBadge } from "@/components/ui/badge";
import { PaymentFlow } from "@/components/payment/payment-flow";
import { StartGeneralRegistrationButton } from "@/components/general-registration/start-button";
import { getProfile } from "@/lib/auth";
import {
  getCoveredEvents,
  getGeneralRegistrationSettings,
  getMyGeneralRegistration,
  isGeneralRegistrationOpen,
} from "@/lib/data/general-registration";
import { getMyRegisteredEventIds } from "@/lib/data/registrations";
import { canTakeGeneralRegistration } from "@/lib/general-registration";
import { dedicatedUpiQrDataUrl } from "@/lib/payment";
import { formatEventDate, formatINR } from "@/lib/utils";

export const metadata: Metadata = {
  title: "General Registration",
  description: "One payment that includes every covered Wissendurst'27 event.",
};

export default async function GeneralRegistrationPage() {
  const [profile, settings, covered] = await Promise.all([
    getProfile(),
    getGeneralRegistrationSettings(),
    getCoveredEvents(),
  ]);
  const [gr, enrolled] = profile
    ? await Promise.all([getMyGeneralRegistration(), getMyRegisteredEventIds()])
    : [null, new Set<string>()];
  const open = isGeneralRegistrationOpen(settings);
  const verified = gr?.status === "verified";

  return (
    <div className="py-14 md:py-20">
      <Container className="max-w-5xl">
        <SectionHeading
          eyebrow="One payment"
          title="General Registration"
          description={
            settings.description ||
            "Pay once and get access to every included event. You still choose and enrol in each event yourself — enrolment is free once your payment is verified."
          }
        />

        <div className="mt-10 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          <section aria-labelledby="gr-status-heading" className="space-y-6">
            <h2 id="gr-status-heading" className="sr-only">
              Your General Registration
            </h2>
            {!profile ? (
              <Panel>
                <p className="text-sm text-muted">Sign in with your approved account to take General Registration.</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <ButtonLink href="/login?next=/general-registration" withArrow>
                    Login
                  </ButtonLink>
                  <ButtonLink href="/signup" variant="outline">
                    Create an account
                  </ButtonLink>
                </div>
              </Panel>
            ) : profile.approval_status !== "approved" ? (
              <Panel tone="warning" icon={<CircleAlert className="size-5" />} title="Waiting for approval">
                Your account must be approved before you can take General Registration.
              </Panel>
            ) : verified ? (
              <Panel tone="success" icon={<BadgeCheck className="size-5" />} title="General Registration verified">
                Your participant ID is{" "}
                <span className="font-mono font-semibold text-foreground">{profile.participant_id}</span>
                {gr?.previous_participant_id && (
                  <> (replaces {gr.previous_participant_id})</>
                )}
                . Enrol in the events below — each is free for you, but seats are limited and are not reserved automatically.
              </Panel>
            ) : gr ? (
              <GrPayment gr={gr} participantId={profile.participant_id ?? ""} instructions={settings.instructions} />
            ) : !canTakeGeneralRegistration(profile.participant_id, profile.approval_status) ? (
              <Panel tone="warning" icon={<CircleAlert className="size-5" />} title="Not available for this account">
                General Registration needs an approved standard participant ID.
              </Panel>
            ) : !open ? (
              <Panel icon={<Info className="size-5" />} title="Not open yet">
                General Registration isn&rsquo;t open right now. Check back soon.
              </Panel>
            ) : (
              <Panel title={`Fee: ${formatINR(settings.fee)}`}>
                <p>
                  One payment covers {covered.length} event{covered.length === 1 ? "" : "s"}. You&rsquo;ll pay to a
                  dedicated General Registration UPI account and upload your payment screenshot for review.
                </p>
                <div className="mt-5">
                  <StartGeneralRegistrationButton fee={settings.fee} />
                </div>
              </Panel>
            )}
          </section>

          <section aria-labelledby="gr-events-heading">
            <h2 id="gr-events-heading" className="font-display text-xl font-semibold text-foreground">
              Included events
            </h2>
            {covered.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No events have been included yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {covered.map((e) => {
                  const isEnrolled = enrolled.has(e.id);
                  return (
                    <li key={e.id} className="rounded-xl border border-border bg-surface p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link href={`/events/${e.slug}`} className="font-medium text-foreground hover:text-brand">
                            {e.title}
                          </Link>
                          <p className="mt-0.5 text-xs text-muted">
                            {e.event_date ? formatEventDate(e.event_date) : "Date to be announced"}
                            {e.team_enabled ? " · Team event" : ""}
                          </p>
                        </div>
                        {verified && (
                          isEnrolled ? (
                            <span className="shrink-0 rounded-full bg-success/12 px-2.5 py-1 text-xs font-medium text-success">
                              Enrolled
                            </span>
                          ) : (
                            <ButtonLink href={`/events/${e.slug}`} size="sm" variant="secondary">
                              Enrol<span className="sr-only"> in {e.title}</span>
                            </ButtonLink>
                          )
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </Container>
    </div>
  );
}

async function GrPayment({
  gr,
  participantId,
  instructions,
}: {
  gr: NonNullable<Awaited<ReturnType<typeof getMyGeneralRegistration>>>;
  participantId: string;
  instructions: string;
}) {
  const note = `WD27 GR ${participantId}`.slice(0, 40);
  // Frozen destination: never falls back to an event or site-default UPI.
  const qr = await dedicatedUpiQrDataUrl(gr.amount, note, gr.upi_id, gr.payee_name);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted">Payment status</span>
        <PaymentBadge status={gr.status} />
      </div>
      {gr.status === "rejected" && (
        <Panel tone="alert" icon={<TriangleAlert className="size-5" />} title="Payment not verified">
          {gr.review_note ? <>Reason: {gr.review_note}. </> : null}
          Your participant ID is unchanged. Upload the correct screenshot and UTR to try again.
        </Panel>
      )}
      {gr.status === "duplicate" && (
        <Panel tone="alert" icon={<TriangleAlert className="size-5" />} title="Transaction already used">
          That UTR is already linked to another payment. Check your payment app and submit the correct one.
        </Panel>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-6">
          <div className="flex items-baseline justify-between">
            <p className="text-sm text-muted">Amount to pay</p>
            <p className="font-display text-3xl font-semibold text-foreground">{formatINR(gr.amount)}</p>
          </div>
          <div className="mt-5 flex flex-col items-center rounded-2xl border border-border bg-white p-4">
            <Image src={qr} alt="General Registration UPI payment QR code" width={220} height={220} unoptimized />
            <p className="mt-2 text-center text-xs text-[#0b2528]">Scan with any UPI app</p>
          </div>
          <dl className="mt-5 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">UPI ID</dt>
              <dd className="break-all font-mono text-foreground">{gr.upi_id}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Payee</dt>
              <dd className="text-foreground">{gr.payee_name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Reference note</dt>
              <dd className="font-mono text-xs text-foreground">{note}</dd>
            </div>
          </dl>
          <p className="mt-5 flex items-start gap-2 rounded-xl border border-border bg-surface-2/60 p-3 text-xs text-muted">
            <Info className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            {instructions ||
              "Pay the exact amount to this General Registration UPI ID only — not an event UPI — then upload the screenshot showing the UTR."}
          </p>
        </div>
        <PaymentFlow registrationId={gr.id} initialStatus={gr.status} kind="general" />
      </div>
    </div>
  );
}

function Panel({
  tone = "neutral",
  icon,
  title,
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "alert";
  icon?: React.ReactNode;
  title?: string;
  children: React.ReactNode;
}) {
  const toneClass = {
    neutral: "border-border bg-surface",
    success: "border-success/30 bg-success/10",
    warning: "border-warning/40 bg-warning/10",
    alert: "border-alert/30 bg-alert/10",
  }[tone];
  const iconClass = { neutral: "text-brand", success: "text-success", warning: "text-warning", alert: "text-alert" }[tone];
  return (
    <div role="status" className={`rounded-2xl border p-6 ${toneClass}`}>
      {(icon || title) && (
        <div className="flex items-center gap-2">
          {icon && <span className={iconClass}>{icon}</span>}
          {title && <h3 className="font-display text-lg font-semibold text-foreground">{title}</h3>}
        </div>
      )}
      <div className={`${icon || title ? "mt-2" : ""} text-sm text-muted`}>{children}</div>
    </div>
  );
}
