import Link from "next/link";
import { ArrowRight, BadgeCheck, Ticket } from "lucide-react";
import { PaymentBadge } from "@/components/ui/badge";
import { formatINR } from "@/lib/utils";
import type { GeneralRegistrationRow } from "@/types/database";

/** Dashboard shortcut + status for General Registration. */
export function GeneralRegistrationCard({
  gr,
  fee,
}: {
  gr: GeneralRegistrationRow | null;
  fee: number;
}) {
  const verified = gr?.status === "verified";
  return (
    <Link
      href="/general-registration"
      className="group flex items-center justify-between gap-4 rounded-2xl border border-brand/30 bg-brand/5 p-5 transition-colors hover:bg-brand/10"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand">
          {verified ? <BadgeCheck className="size-5" aria-hidden /> : <Ticket className="size-5" aria-hidden />}
        </span>
        <div className="min-w-0">
          <p className="font-medium text-foreground">General Registration</p>
          <p className="mt-0.5 text-sm text-muted">
            {verified
              ? "Verified — enrol in your included events for free."
              : gr
                ? `${formatINR(gr.amount)} · finish or check your payment`
                : `One payment of ${formatINR(fee)} covers every included event.`}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {gr && <PaymentBadge status={gr.status} />}
        <ArrowRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
      </div>
    </Link>
  );
}
