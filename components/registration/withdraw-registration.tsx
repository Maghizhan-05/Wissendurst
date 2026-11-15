"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogOut, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withdrawRegistration } from "@/lib/actions/registration";
import { WITHDRAW_COPY } from "@/lib/registration-withdrawal";

/**
 * D-029 "Withdraw registration": a two-step control (ask, then confirm) for an
 * eligible solo intent or a team head's whole unpaid team. The server action
 * (cancel_my_registration) is the authority; this only collects intent.
 */
export function WithdrawRegistration({
  registrationId,
  slug,
  kind,
}: {
  registrationId: string;
  slug: string;
  kind: "solo" | "team_head";
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(withdrawRegistration, null);
  const copy = WITHDRAW_COPY[kind];

  useEffect(() => {
    if (!state) return;
    if (!state.ok) {
      toast.error(state.error);
      return;
    }
    toast.success(kind === "team_head" ? "Team registration withdrawn." : "Registration withdrawn.");
    router.push(state.next ?? "/events");
    router.refresh();
  }, [state, router, kind]);

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      {confirming ? (
        <form action={formAction} className="flex flex-col gap-3" aria-live="polite">
          <input type="hidden" name="registration_id" value={registrationId} />
          <input type="hidden" name="slug" value={slug} />
          <div className="flex items-start gap-2.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-alert" aria-hidden />
            <div className="text-sm">
              <p className="font-semibold text-foreground">{copy.title}</p>
              <p className="mt-1 text-muted">{copy.body}</p>
              {state && !state.ok && <p className="mt-2 text-alert">{state.error}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={pending}>
              {pending ? "Withdrawing…" : copy.confirm}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
              Keep registration
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted">
            {kind === "team_head" ? "Changed plans? You can withdraw the whole team before paying." : "Changed plans? You can withdraw before paying."}
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>
            <LogOut className="size-4" aria-hidden /> Withdraw registration
          </Button>
        </div>
      )}
    </div>
  );
}
