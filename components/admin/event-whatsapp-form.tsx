"use client";

import { useActionState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { setEventWhatsAppLink } from "@/lib/actions/event-admin";
import type { AdminActionState } from "@/lib/actions/admin";

/**
 * Optional private WhatsApp group link of one event (0034). Never shown on
 * the site; sent only in the successful-registration email to each confirmed
 * participant / team member.
 */
export function EventWhatsAppForm({
  eventId,
  initialUrl,
}: {
  eventId: string;
  initialUrl: string | null;
}) {
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(
    setEventWhatsAppLink,
    null,
  );

  return (
    <form
      action={formAction}
      aria-labelledby="whatsapp-heading"
      className="space-y-4 rounded-2xl border border-border bg-surface p-5"
    >
      <input type="hidden" name="id" value={eventId} />
      <div>
        <h2 id="whatsapp-heading" className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
          <Lock className="size-4 text-brand" aria-hidden /> Private WhatsApp group
        </h2>
        <p className="mt-1 text-sm text-muted">
          Optional. Never shown on the website — it is included only in the confirmation
          email each participant (and every team member) receives once their registration
          is confirmed.
        </p>
      </div>
      <Field
        label="Group invite link"
        htmlFor="whatsapp_group_url"
        hint="Must be a https://chat.whatsapp.com/… invite link. Clear the field and save to remove it."
      >
        <Input
          id="whatsapp_group_url"
          name="whatsapp_group_url"
          type="url"
          inputMode="url"
          defaultValue={initialUrl ?? ""}
          placeholder="https://chat.whatsapp.com/AbCdEf123456"
          maxLength={200}
          autoComplete="off"
        />
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
      <Button type="submit" variant="secondary" loading={pending}>
        Save link
      </Button>
    </form>
  );
}
