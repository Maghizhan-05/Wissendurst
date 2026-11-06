import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { PaymentBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { getPaymentQueue } from "@/lib/data/admin";
import { formatEventDate, formatINR } from "@/lib/utils";
import { requireScope } from "@/lib/auth";
import { teamDisplay } from "@/lib/team-label";

export const metadata: Metadata = { title: "Admin · Payments" };

export default async function AdminPaymentsPage() {
  await requireScope("payments");
  const queue = await getPaymentQueue();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Payment review queue
        </h1>
        <p className="mt-1 text-sm text-muted">
          {queue.length} payment{queue.length === 1 ? "" : "s"} awaiting review
        </p>
      </div>

      {queue.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="size-8 text-success" />}
          title="All caught up"
          description="No payments are waiting for review."
        />
      ) : (
        <ul className="space-y-3">
          {queue.map((r) => (
            <li key={r.id}>
              <Link
                href={`/admin/payments/${r.id}`}
                className={`flex items-center justify-between gap-4 rounded-2xl border p-4 transition-colors ${
                  r.payment_status === "duplicate"
                    ? "border-alert/30 bg-alert/5 hover:bg-alert/10"
                    : "border-border bg-surface hover:bg-surface-2/40"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-brand">
                      {r.profile.participant_id}
                    </span>
                    <span className="truncate font-medium text-foreground">
                      {r.profile.full_name}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted">
                    {r.event.title}
                    {teamDisplay(r.team) ? ` · Team: ${teamDisplay(r.team)}` : ""} · {formatINR(r.amount)} ·{" "}
                    {formatEventDate(r.registered_at.slice(0, 10))}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <PaymentBadge status={r.payment_status} />
                  <ArrowRight className="size-4 text-muted" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
