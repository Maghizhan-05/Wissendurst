"use client";

import { Check, X } from "lucide-react";
import { ConfirmActionDialog } from "@/components/admin/confirm-action-dialog";
import { reviewGeneralRegistrationAction } from "@/lib/actions/general-registration";

function NoteField() {
  return (
    <label className="block pt-1">
      <span className="text-xs font-medium text-foreground">Note (optional, shared with the participant on rejection)</span>
      <textarea
        name="note"
        rows={2}
        maxLength={500}
        className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground"
      />
    </label>
  );
}

export function GeneralRegistrationReviewActions({
  id,
  currentId,
}: {
  id: string;
  currentId: string | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <ConfirmActionDialog
        action={reviewGeneralRegistrationAction}
        fields={{ id, status: "verified" }}
        triggerLabel="Verify General Registration payment"
        triggerIcon={
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-white">
            <Check className="size-4" aria-hidden /> Verify
          </span>
        }
        triggerClassName="w-full justify-center rounded-xl bg-success px-3 py-2.5 hover:opacity-90"
        title="Verify and convert the participant ID?"
        description={
          <>
            <p>
              This confirms the payment and permanently converts {currentId ?? "the participant's ID"} into the next
              General Registration ID. The released E number will be reused for a future participant. This cannot be undone.
            </p>
            <NoteField />
          </>
        }
        confirmLabel="Verify and convert"
        tone="warning"
      />
      <ConfirmActionDialog
        action={reviewGeneralRegistrationAction}
        fields={{ id, status: "rejected" }}
        triggerLabel="Reject General Registration payment"
        triggerIcon={
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-white">
            <X className="size-4" aria-hidden /> Reject
          </span>
        }
        triggerClassName="w-full justify-center rounded-xl bg-alert px-3 py-2.5 hover:opacity-90"
        title="Reject this payment?"
        description={
          <>
            <p>The participant keeps their current ID and can resubmit a corrected screenshot and UTR.</p>
            <NoteField />
          </>
        }
        confirmLabel="Reject payment"
        tone="danger"
      />
    </div>
  );
}
