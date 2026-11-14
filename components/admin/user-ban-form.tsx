"use client";

import { useActionState, useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { setUserBan, type AdminActionState } from "@/lib/actions/admin";

/**
 * Super admin only: suspend / restore an account (0035). A reason is
 * required both ways and kept in the account's append-only history.
 */
export function UserBanForm({ userId, banned }: { userId: string; banned: boolean }) {
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(setUserBan, null);
  const [confirming, setConfirming] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="banned" value={banned ? "false" : "true"} />
      <Field
        label={banned ? "Reason for lifting the suspension" : "Reason for suspending"}
        htmlFor="ban_reason"
        hint="Required. Kept in this account's history with your name and the time."
      >
        <Textarea id="ban_reason" name="reason" rows={2} maxLength={300} required />
      </Field>
      <div role="status" aria-live="polite">
        {state && !state.ok && (
          <p className="rounded-lg border border-alert/30 bg-alert/10 px-3 py-2 text-sm text-alert">{state.error}</p>
        )}
        {state?.ok && state.message && (
          <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
            {state.message}
          </p>
        )}
      </div>
      {banned ? (
        <Button type="submit" variant="secondary" loading={pending}>
          <ShieldCheck className="size-4" aria-hidden /> Lift suspension
        </Button>
      ) : confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="danger" loading={pending}>
            <ShieldOff className="size-4" aria-hidden /> Confirm suspension
          </Button>
          <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
          <ShieldOff className="size-4" aria-hidden /> Suspend account…
        </Button>
      )}
    </form>
  );
}
