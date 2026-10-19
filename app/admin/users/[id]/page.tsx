import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, PaymentBadge, RegistrationBadge } from "@/components/ui/badge";
import { AdminAccessForm } from "@/components/admin/admin-access-form";
import { ApprovalActions } from "@/components/admin/approval-actions";
import { EmptyState } from "@/components/ui/misc";
import { getUserWithRegistrations } from "@/lib/data/admin";
import { requireScope } from "@/lib/auth";
import { ADMIN_SCOPE_LABELS, APPROVAL_STATUS_LABELS } from "@/lib/constants";
import { formatEventDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · User" };

export default async function AdminUserPage({
  params,
}: PageProps<"/admin/users/[id]">) {
  const viewer = await requireScope("signups");
  const { id } = await params;
  const data = await getUserWithRegistrations(id);
  if (!data) notFound();
  const { profile, registrations } = data;

  const approvalTone =
    profile.approval_status === "approved"
      ? "success"
      : profile.approval_status === "rejected"
        ? "alert"
        : "warning";

  const fields = [
    ["Email", profile.email],
    ["Phone", profile.phone ?? "—"],
    ["College", profile.college ?? "—"],
    ["Course", profile.course ?? "—"],
    ["Year", profile.year ?? "—"],
  ] as const;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to users
      </Link>

      <div className="rounded-2xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-sm text-brand">
              {profile.participant_id ?? "Pending approval"}
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold text-foreground">
              {profile.full_name || "Unnamed participant"}
            </h1>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge tone={approvalTone}>
              {APPROVAL_STATUS_LABELS[profile.approval_status]}
            </Badge>
            {profile.role === "admin" && (
              <Badge tone="brand">
                {profile.is_super_admin
                  ? "Super admin"
                  : profile.admin_scopes.length
                    ? profile.admin_scopes
                        .map((s) => ADMIN_SCOPE_LABELS[s])
                        .join(", ")
                    : "Admin (no scopes)"}
              </Badge>
            )}
          </div>
        </div>

        {profile.approval_status === "pending" && (
          <div className="mt-5 rounded-xl border border-warning/30 bg-warning/10 p-4">
            <p className="mb-2 text-sm font-medium text-foreground">
              This account is awaiting approval
            </p>
            <ApprovalActions userId={profile.id} compact />
          </div>
        )}

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                {label}
              </dt>
              <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {viewer.is_super_admin && (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="font-display text-lg font-semibold text-foreground">
            Admin access
          </h2>
          <p className="mt-1 text-sm text-muted">
            Grant staff access and choose which areas this person can manage.
          </p>
          <div className="mt-4 max-w-md">
            <AdminAccessForm
              userId={profile.id}
              role={profile.role}
              isSuper={profile.is_super_admin}
              scopes={profile.admin_scopes}
            />
          </div>
        </div>
      )}

      <div>
        <h2 className="font-display text-lg font-semibold text-foreground">
          Registrations ({registrations.length})
        </h2>
        {registrations.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="No registrations" description="This user hasn't registered for any events." />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border bg-surface-2/50 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 font-medium">Payment</th>
                  <th className="px-4 py-3 font-medium">Registration</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 text-right font-medium">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {registrations.map((r) => (
                  <tr key={r.id} className="bg-surface hover:bg-surface-2/40">
                    <td className="px-4 py-3 text-foreground">{r.event.title}</td>
                    <td className="px-4 py-3">
                      <PaymentBadge status={r.payment_status} />
                    </td>
                    <td className="px-4 py-3">
                      <RegistrationBadge status={r.registration_status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {formatEventDate(r.registered_at.slice(0, 10))}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/payments/${r.id}`}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2"
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
