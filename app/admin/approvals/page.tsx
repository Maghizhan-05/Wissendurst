import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { EmptyState } from "@/components/ui/misc";
import { getPendingSignups } from "@/lib/data/admin";
import { requireScope } from "@/lib/auth";
import { formatEventDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Approvals" };

export default async function AdminApprovalsPage() {
  await requireScope("signups");
  const pending = await getPendingSignups();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Signup approvals
        </h1>
        <p className="mt-1 text-sm text-muted">
          {pending.length} account{pending.length === 1 ? "" : "s"} awaiting review
        </p>
      </div>

      {pending.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="size-8 text-success" />}
          title="All caught up"
          description="No sign-ups are waiting for approval."
        />
      ) : (
        <ul className="space-y-3">
          {pending.map((u) => (
            <li key={u.id}>
              <Link
                href={`/admin/approvals/${u.id}`}
                className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-4 transition-colors hover:bg-surface-2/40"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {u.full_name || "Unnamed"}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-muted">
                    {u.email} · {u.college ?? "—"} ·{" "}
                    {formatEventDate(u.created_at.slice(0, 10))}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm font-medium text-brand">
                  Review ID <ArrowRight className="size-4" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
