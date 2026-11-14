"use client";

import { useActionState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { setEventGoogleFormLink } from "@/lib/actions/event-admin";
import type { AdminActionState } from "@/lib/actions/admin";

/**
 * Optional private Google Form link of one event (0035 / D-023). Never shown
 * on the site; sent only in the paid payment-confirmed email to each
 * confirmed participant / team member.
 */
export function EventGoogleFormForm({
  eventId,
  initialUrl,
}: {
  eventId: string;
  initialUrl: string | null;
}) {
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(
    setEventGoogleFormLink,
    null,
  );

  return (
    <form
      action={formAction}
      aria-labelledby="google-form-heading"
      className="space-y-4 rounded-2xl border border-border bg-surface p-5"
    >
      <input type="hidden" name="id" value={eventId} />
      <div>
        <h2 id="google-form-heading" className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
          <Lock className="size-4 text-brand" aria-hidden /> Private Google Form
        </h2>
        <p className="mt-1 text-sm text-muted">
          Optional. Never shown on the website — it is included only in the payment-confirmed
          email each participant (and every team member) receives once their payment is
          verified. Free registrations don&rsquo;t receive it.
        </p>
      </div>
      <Field
        label="Form link"
        htmlFor="google_form_url"
        hint="Use the form's share link: https://forms.gle/… or https://docs.google.com/forms/d/e/…/viewform. Edit links aren't accepted. Clear the field and save to remove it."
      >
        <Input
          id="google_form_url"
          name="google_form_url"
          type="url"
          inputMode="url"
          defaultValue={initialUrl ?? ""}
          placeholder="https://forms.gle/AbC123xyz"
          maxLength={500}
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
