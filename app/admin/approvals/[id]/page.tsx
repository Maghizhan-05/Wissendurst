import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ApprovalActions } from "@/components/admin/approval-actions";
import { getProfileAdmin } from "@/lib/data/admin";
import { getIdCardSignedUrl } from "@/lib/actions/admin";
import { requireScope } from "@/lib/auth";
import { APPROVAL_STATUS_LABELS } from "@/lib/constants";
import { formatEventDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Review sign-up" };

export default async function ApprovalReviewPage({
  params,
}: PageProps<"/admin/approvals/[id]">) {
  await requireScope("signups");
  const { id } = await params;
  const user = await getProfileAdmin(id);
  if (!user) notFound();

  const idCardUrl = user.id_card_path
    ? await getIdCardSignedUrl(user.id_card_path)
    : null;

  const fields = [
    ["Email", user.email],
    ["Phone", user.phone ?? "—"],
    ["College", user.college ?? "—"],
    ["Course", user.course ?? "—"],
    ["Year", user.year ?? "—"],
    ["Signed up", formatEventDate(user.created_at.slice(0, 10))],
  ] as const;

  const tone =
    user.approval_status === "approved"
      ? "success"
      : user.approval_status === "rejected"
        ? "alert"
        : "warning";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/admin/approvals"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to approvals
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">
            {user.full_name || "Unnamed participant"}
          </h1>
          <p className="mt-1 text-sm text-muted">{user.email}</p>
        </div>
        <Badge tone={tone}>{APPROVAL_STATUS_LABELS[user.approval_status]}</Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-2xl border border-border bg-surface p-3">
          {idCardUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={idCardUrl}
              alt="ID card"
              className="max-h-[560px] w-full rounded-xl object-contain"
            />
          ) : (
            <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-muted">
              <ImageOff className="size-8" />
              <p className="text-sm">No ID card uploaded</p>
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <dl className="space-y-3 text-sm">
              {fields.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <dt className="text-muted">{label}</dt>
                  <dd className="text-right text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5">
            <p className="mb-3 text-sm font-medium text-foreground">Decision</p>
            {user.approval_status === "pending" ? (
              <>
                <ApprovalActions userId={user.id} />
                <p className="mt-3 text-xs text-muted">
                  Approving issues a participant ID and emails them that they can sign in. Rejecting emails
                  them a link to correct and resubmit the same application.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">
                {user.approval_status === "approved"
                  ? "Approved. Approval can't be undone from here."
                  : "Rejected — waiting for the applicant to correct and resubmit. It returns to Approvals when they do."}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
