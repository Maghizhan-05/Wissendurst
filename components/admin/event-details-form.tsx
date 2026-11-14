"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { rulesToEditorText } from "@/lib/events/rules";
import { RULES_HINT, RULES_PLACEHOLDER } from "@/components/admin/rules-guidance";
import { updateEventDetails } from "@/lib/actions/event-admin";
import type { AdminActionState } from "@/lib/actions/admin";
import type { EventRow } from "@/types/database";

/**
 * Details editor for event administrators (0034): only the descriptive fields
 * the database lets them change (event_admin_update_event_details).
 */
export function EventDetailsForm({ event }: { event: EventRow }) {
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(
    updateEventDetails,
    null,
  );

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="id" value={event.id} />

      <Field label="Short description" htmlFor="short_description" hint="One line, shown on cards" required>
        <Input
          id="short_description"
          name="short_description"
          defaultValue={event.short_description}
          minLength={5}
          maxLength={180}
          required
        />
      </Field>

      <Field label="Description" htmlFor="description" hint="Full overview shown on the event page">
        <Textarea id="description" name="description" defaultValue={event.description} rows={5} maxLength={5000} />
      </Field>

      <Field label="Rules" htmlFor="rules" hint={RULES_HINT}>
        <Textarea
          id="rules"
          name="rules"
          defaultValue={rulesToEditorText(event.rules)}
          rows={8}
          placeholder={RULES_PLACEHOLDER}
        />
      </Field>

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Eligibility" htmlFor="eligibility">
          <Input id="eligibility" name="eligibility" defaultValue={event.eligibility ?? ""} maxLength={300} />
        </Field>
        <Field label="Venue" htmlFor="venue">
          <Input id="venue" name="venue" defaultValue={event.venue ?? ""} maxLength={160} />
        </Field>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <Field label="Date" htmlFor="event_date">
          <Input id="event_date" name="event_date" type="date" defaultValue={event.event_date ?? ""} />
        </Field>
        <Field label="Start time" htmlFor="start_time">
          <Input id="start_time" name="start_time" type="time" defaultValue={event.start_time?.slice(0, 5) ?? ""} />
        </Field>
        <Field label="End time" htmlFor="end_time">
          <Input id="end_time" name="end_time" type="time" defaultValue={event.end_time?.slice(0, 5) ?? ""} />
        </Field>
      </div>

      <p className="text-xs text-muted">
        Title, category, fees, capacity, team settings and visibility are managed by the
        events team.
      </p>

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

      <div className="flex gap-3 border-t border-border pt-6">
        <Button type="submit" loading={pending}>
          Save details
        </Button>
      </div>
    </form>
  );
}
