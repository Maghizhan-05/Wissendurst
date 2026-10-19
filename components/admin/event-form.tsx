"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { slugify } from "@/lib/utils";
import { EVENT_CATEGORIES, EVENT_CATEGORY_LABELS } from "@/lib/constants";
import type { AdminActionState } from "@/lib/actions/admin";
import type { EventRow } from "@/types/database";

type Action = (
  prev: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

export function EventForm({
  action,
  event,
  parents = [],
  defaultParentId = "",
}: {
  action: Action;
  event?: EventRow;
  /** Events this one may be nested under (depth 0 = event, 1 = sub-event). */
  parents?: { id: string; title: string; depth: number }[];
  /** Preselected parent (e.g. when adding a sub-event from a parent row). */
  defaultParentId?: string;
}) {
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(
    action,
    null,
  );
  const [slug, setSlug] = useState(event?.slug ?? "");

  return (
    <form action={formAction} className="space-y-6">
      {event && <input type="hidden" name="id" value={event.id} />}

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Title" htmlFor="title" required>
          <Input
            id="title"
            name="title"
            defaultValue={event?.title}
            required
            onBlur={(e) => {
              if (!slug) setSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <Field label="Slug" htmlFor="slug" hint="Used in the URL: /events/your-slug" required>
          <Input
            id="slug"
            name="slug"
            value={slug}
            onChange={(e) => setSlug(slugify(e.target.value))}
            required
          />
        </Field>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Category" htmlFor="category" required>
          <Select id="category" name="category" defaultValue={event?.category ?? "workshop"}>
            {EVENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EVENT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Registration fee (₹)" htmlFor="fee" hint="0 for a free event" required>
          <Input
            id="fee"
            name="registration_fee_rupees"
            type="number"
            min={0}
            defaultValue={event ? event.registration_fee / 100 : 0}
            required
          />
        </Field>
      </div>

      <Field
        label="Belongs to (broader event)"
        htmlFor="parent_event_id"
        hint="Leave as “None” for a top-level event. Pick a broader event to nest this under it — up to three levels (event → sub-event → sub-sub-event)."
      >
        <Select
          id="parent_event_id"
          name="parent_event_id"
          defaultValue={event?.parent_event_id ?? defaultParentId ?? ""}
        >
          <option value="">None — top-level event</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.depth > 0 ? `${" ".repeat(p.depth * 2)}↳ ` : ""}
              {p.title}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Payment UPI ID"
        htmlFor="upi_id"
        hint="Shown as the payment QR for this event. Leave blank to inherit the broader event's UPI (and finally the site default)."
      >
        <Input
          id="upi_id"
          name="upi_id"
          defaultValue={event?.upi_id ?? ""}
          placeholder="name@bank"
          maxLength={120}
        />
      </Field>

      <div className="rounded-xl border border-border bg-surface-2/40 p-4">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            name="discount_enabled"
            defaultChecked={event?.discount_enabled ?? false}
            className="size-4 accent-[var(--brand)]"
          />
          Sibling discount
        </label>
        <p className="mt-1 text-xs text-muted">
          Set this on a <strong>broader event (any level that has sub-events)</strong>.
          Once a participant has a <strong>verified payment</strong> for one
          sub-event under it, their next registration for another sub-event
          under the same broader event gets this amount off.
        </p>
        <div className="mt-3 max-w-xs">
          <Field label="Discount amount (₹)" htmlFor="discount_amount_rupees">
            <Input
              id="discount_amount_rupees"
              name="discount_amount_rupees"
              type="number"
              min={0}
              defaultValue={event ? event.discount_amount / 100 : 0}
            />
          </Field>
        </div>
      </div>

      <Field label="Short description" htmlFor="short_description" hint="One line, shown on cards" required>
        <Input
          id="short_description"
          name="short_description"
          defaultValue={event?.short_description}
          maxLength={180}
          required
        />
      </Field>

      <Field label="Description" htmlFor="description" hint="Full overview shown on the event page">
        <Textarea id="description" name="description" defaultValue={event?.description} rows={5} />
      </Field>

      <Field label="Rules" htmlFor="rules" hint="One rule per line">
        <Textarea
          id="rules"
          name="rules"
          defaultValue={event?.rules?.join("\n")}
          rows={5}
          placeholder={"Teams of two\nCarry your college ID"}
        />
      </Field>

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Eligibility" htmlFor="eligibility">
          <Input id="eligibility" name="eligibility" defaultValue={event?.eligibility ?? ""} />
        </Field>
        <Field label="Venue" htmlFor="venue">
          <Input id="venue" name="venue" defaultValue={event?.venue ?? ""} />
        </Field>
      </div>

      <div className="grid gap-5 md:grid-cols-4">
        <Field label="Date" htmlFor="event_date">
          <Input id="event_date" name="event_date" type="date" defaultValue={event?.event_date ?? ""} />
        </Field>
        <Field label="Start time" htmlFor="start_time">
          <Input id="start_time" name="start_time" type="time" defaultValue={event?.start_time?.slice(0, 5) ?? ""} />
        </Field>
        <Field label="End time" htmlFor="end_time">
          <Input id="end_time" name="end_time" type="time" defaultValue={event?.end_time?.slice(0, 5) ?? ""} />
        </Field>
        <Field label="Capacity" htmlFor="max_participants" hint="Blank = unlimited">
          <Input
            id="max_participants"
            name="max_participants"
            type="number"
            min={0}
            defaultValue={event?.max_participants ?? ""}
          />
        </Field>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Hero image URL" htmlFor="hero_image" hint="Optional; upload to storage and paste URL">
          <Input id="hero_image" name="hero_image" type="url" defaultValue={event?.hero_image ?? ""} />
        </Field>
        <Field label="Thumbnail image URL" htmlFor="thumbnail_image" hint="Optional">
          <Input id="thumbnail_image" name="thumbnail_image" type="url" defaultValue={event?.thumbnail_image ?? ""} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="is_live"
            defaultChecked={event?.is_live ?? false}
            className="size-4 accent-[var(--brand)]"
          />
          Live
          <span className="text-xs text-muted">(off = &ldquo;Coming soon&rdquo;)</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="registration_open"
            defaultChecked={event ? event.registration_open : true}
            className="size-4 accent-[var(--brand)]"
          />
          Registration open
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="featured"
            defaultChecked={event?.featured ?? false}
            className="size-4 accent-[var(--brand)]"
          />
          Featured on landing page
        </label>
      </div>

      <div className="rounded-xl border border-border bg-surface-2/40 p-4">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            name="team_enabled"
            defaultChecked={event?.team_enabled ?? false}
            className="size-4 accent-[var(--brand)]"
          />
          Team registration
        </label>
        <p className="mt-1 text-xs text-muted">
          When on, participants register as a team. The team head enters
          teammates by their <strong>participant ID</strong> (W27/E/…), everyone
          is grouped, and the head pays a single flat team fee (the registration
          fee above, not multiplied by team size). A person may also join on
          their own (team of one); nobody can be on more than one team per event.
        </p>
        <div className="mt-3 max-w-xs">
          <Field
            label="Max team size"
            htmlFor="team_max"
            hint="Head included. Teams can be any size from 1 up to this."
          >
            <Input
              id="team_max"
              name="team_max"
              type="number"
              min={1}
              max={100}
              defaultValue={event?.team_max ?? 4}
            />
          </Field>
        </div>
      </div>

      {state && !state.ok && (
        <p className="rounded-lg border border-alert/30 bg-alert/10 px-3 py-2 text-sm text-alert">
          {state.error}
        </p>
      )}

      <div className="flex gap-3 border-t border-border pt-6">
        <Button type="submit" loading={pending}>
          {event ? "Save changes" : "Create event"}
        </Button>
      </div>
    </form>
  );
}
