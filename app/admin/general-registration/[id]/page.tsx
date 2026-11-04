import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ImageOff, TriangleAlert } from "lucide-react";
import { PaymentBadge } from "@/components/ui/badge";
import { GeneralRegistrationReviewActions } from "@/components/admin/general-registration-review-actions";
import { getGeneralRegistrationAdmin } from "@/lib/data/general-registration";
import { getScreenshotSignedUrl } from "@/lib/actions/admin";
import { requireScope } from "@/lib/auth";
import { PAYMENT_STATUS_LABELS } from "@/lib/constants";
import { formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · General Registration review" };

const dt = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));

export default async function GeneralRegistrationReviewPage({
  params,
}: PageProps<"/admin/general-registration/[id]">) {
  await requireScope("payments");
  const { id } = await params;
  const data = await getGeneralRegistrationAdmin(id);
  if (!data) notFound();
  const { record: r, audit, idHistory } = data;
  const screenshotUrl = r.payment_screenshot ? await getScreenshotSignedUrl(r.payment_screenshot) : null;
  const duplicateNote = r.status === "duplicate" ? [...audit].reverse().find((a) => a.to_status === "duplicate")?.note : null;

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/admin/general-registration"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to General Registration
      </Link>
      <h1 className="mt-4 font-display text-2xl font-semibold text-foreground">Review General Registration</h1>

      {r.status === "duplicate" && (
        <div role="alert" className="mt-4 flex items-start gap-3 rounded-xl border border-alert/40 bg-alert/10 p-4 text-sm">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-alert" aria-hidden />
          <div>
            <p className="font-semibold text-alert">Duplicate transaction detected</p>
            <p className="mt-1 text-muted">{duplicateNote ?? "This UTR is already linked to another payment."} Do not verify unless you&rsquo;ve confirmed a genuine separate payment.</p>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-2xl border border-border bg-surface p-3">
          {screenshotUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={screenshotUrl} alt="General Registration payment screenshot" className="max-h-[600px] w-full rounded-xl object-contain" />
          ) : (
            <div className="flex h-80 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-muted">
              <ImageOff className="size-8" aria-hidden />
              <p className="text-sm">No screenshot uploaded yet</p>
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <dl className="space-y-3 text-sm">
              <Row label="Participant">
                <Link href={`/admin/users/${r.profile_id}`} className="font-medium text-foreground hover:text-brand">
                  {r.profile?.full_name}
                </Link>
              </Row>
              <Row label="Current ID"><span className="font-mono text-brand">{r.profile?.participant_id ?? "—"}</span></Row>
              <Row label="Previous ID"><span className="font-mono">{r.previous_participant_id ?? "—"}</span></Row>
              <Row label="Email">{r.profile?.email}</Row>
              <Row label="Phone">{r.profile?.phone ?? "—"}</Row>
              <Row label="Amount (frozen)"><span className="font-mono">{formatINR(r.amount)}</span></Row>
              <Row label="Paid to (frozen)"><span className="font-mono">{r.upi_id}</span></Row>
              <Row label="Transaction ID"><span className="font-mono">{r.transaction_id ?? "—"}</span></Row>
              <Row label="Status"><PaymentBadge status={r.status} /></Row>
              {r.ocr_confidence != null && <Row label="OCR confidence">{Math.round(Number(r.ocr_confidence) * 100)}%</Row>}
              {r.review_note && <Row label="Review note">{r.review_note}</Row>}
            </dl>
            {r.ocr_raw_text && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs font-medium text-muted hover:text-foreground">Raw OCR text</summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs text-muted">{r.ocr_raw_text}</pre>
              </details>
            )}
          </div>

          {r.status !== "verified" && (
            <div className="rounded-2xl border border-border bg-surface p-5">
              <p className="mb-3 text-sm font-medium text-foreground">Decision</p>
              <GeneralRegistrationReviewActions id={r.id} currentId={r.profile?.participant_id ?? null} />
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="gr-audit" className="rounded-2xl border border-border bg-surface p-5">
          <h2 id="gr-audit" className="font-display text-lg font-semibold text-foreground">Payment audit</h2>
          <ol className="mt-3 space-y-3 text-sm">
            {audit.map((a) => (
              <li key={a.id} className="border-l-2 border-border pl-3">
                <p className="text-foreground">
                  {a.action.replace(/_/g, " ")}
                  {a.to_status && <> → {PAYMENT_STATUS_LABELS[a.to_status]}</>}
                </p>
                {(a.previous_participant_id || a.new_participant_id) && (
                  <p className="font-mono text-xs text-brand">{a.previous_participant_id} → {a.new_participant_id}</p>
                )}
                {a.note && <p className="text-xs text-muted">{a.note}</p>}
                <p className="text-xs text-muted">{dt(a.created_at)}</p>
              </li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="gr-ids" className="rounded-2xl border border-border bg-surface p-5">
          <h2 id="gr-ids" className="font-display text-lg font-semibold text-foreground">Participant ID history</h2>
          {idHistory.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Visible to admins with the signups scope.</p>
          ) : (
            <ol className="mt-3 space-y-2 text-sm">
              {idHistory.map((h, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span><span className="capitalize">{h.action}</span> <span className="font-mono">{h.participant_id}</span></span>
                  <span className="text-xs text-muted">{dt(h.created_at)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
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
