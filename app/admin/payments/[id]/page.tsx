import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, TriangleAlert, ImageOff } from "lucide-react";
import { PaymentBadge, RegistrationBadge } from "@/components/ui/badge";
import { PaymentReviewActions } from "@/components/admin/payment-review-actions";
import { getRegistrationAdmin } from "@/lib/data/admin";
import { getScreenshotSignedUrl } from "@/lib/actions/admin";
import { requireScope } from "@/lib/auth";
import { formatEventDate, formatINR } from "@/lib/utils";
import { teamDisplay } from "@/lib/team-label";

export const metadata: Metadata = { title: "Admin · Payment review" };

export default async function PaymentReviewPage({
  params,
}: PageProps<"/admin/payments/[id]">) {
  await requireScope("payments");
  const { id } = await params;
  const reg = await getRegistrationAdmin(id);
  if (!reg) notFound();

  const screenshotUrl = reg.payment_screenshot
    ? await getScreenshotSignedUrl(reg.payment_screenshot)
    : null;

  const original = reg.duplicate_of
    ? await getRegistrationAdmin(reg.duplicate_of)
    : null;

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/admin/payments"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to queue
      </Link>

      <h1 className="mt-4 font-display text-2xl font-semibold text-foreground">
        Review payment
      </h1>

      {reg.payment_status === "duplicate" && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-alert/40 bg-alert/10 p-4">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-alert" />
          <div className="text-sm">
            <p className="font-semibold text-alert">Duplicate transaction detected</p>
            <p className="mt-1 text-muted">
              This transaction ID was already submitted
              {original ? (
                <>
                  {" "}
                  by{" "}
                  <Link
                    href={`/admin/payments/${original.id}`}
                    className="font-medium text-foreground underline"
                  >
                    {original.profile.participant_id} · {original.profile.full_name}
                  </Link>
                </>
              ) : (
                " by another registration"
              )}
              . Do not verify unless you&rsquo;ve confirmed a genuine separate
              payment.
            </p>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        {/* Screenshot */}
        <div className="rounded-2xl border border-border bg-surface p-3">
          {screenshotUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={screenshotUrl}
              alt="Payment screenshot"
              className="max-h-[600px] w-full rounded-xl object-contain"
            />
          ) : (
            <div className="flex h-80 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-muted">
              <ImageOff className="size-8" />
              <p className="text-sm">No screenshot uploaded yet</p>
            </div>
          )}
        </div>

        {/* Details + actions */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <dl className="space-y-3 text-sm">
              <Row label="Participant">
                <Link
                  href={`/admin/users/${reg.profile.id}`}
                  className="font-medium text-foreground hover:text-brand"
                >
                  {reg.profile.full_name}
                </Link>
                <span className="ml-2 font-mono text-xs text-brand">
                  {reg.profile.participant_id}
                </span>
              </Row>
              <Row label="Email">{reg.profile.email}</Row>
              <Row label="Phone">{reg.profile.phone ?? "—"}</Row>
              <Row label="Event">{reg.event.title}</Row>
              {teamDisplay(reg.team) && (
                <Row label="Team">
                  <span className="break-words">{teamDisplay(reg.team)}</span>
                  <span className="ml-2 text-xs text-muted">
                    {reg.is_team_head ? `head · ${reg.team?.member_count} people` : "member"}
                  </span>
                </Row>
              )}
              <Row label="Amount">
                <span className="font-mono">{formatINR(reg.amount)}</span>
              </Row>
              <Row label="Transaction ID">
                <span className="font-mono">{reg.transaction_id ?? "—"}</span>
              </Row>
              <Row label="Registered">
                {formatEventDate(reg.registered_at.slice(0, 10))}
              </Row>
              <Row label="Payment">
                <PaymentBadge status={reg.payment_status} />
              </Row>
              <Row label="Registration">
                <RegistrationBadge status={reg.registration_status} />
              </Row>
              {reg.ocr_confidence != null && (
                <Row label="OCR confidence">
                  {Math.round(Number(reg.ocr_confidence) * 100)}%
                </Row>
              )}
            </dl>

            {reg.ocr_raw_text && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs font-medium text-muted hover:text-foreground">
                  Raw OCR text
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs text-muted">
                  {reg.ocr_raw_text}
                </pre>
              </details>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5">
            <p className="mb-3 text-sm font-medium text-foreground">Decision</p>
            <PaymentReviewActions registrationId={reg.id} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-foreground">{children}</dd>
    </div>
  );
}
