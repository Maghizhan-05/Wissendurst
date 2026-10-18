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
  hasChildren = false,
}: {
  action: Action;
  event?: EventRow;
  /** Top-level events this one may be nested under. */
  parents?: { id: string; title: string }[];
  /** Preselected parent (e.g. when adding a sub-event from a parent row). */
  defaultParentId?: string;
  /** True when this event already has sub-events — it can't become one. */
  hasChildren?: boolean;
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

      {hasChildren ? (
        <Field
          label="Broader event"
          htmlFor="parent_event_id"
          hint="This is a broader event with its own sub-events, so it stays top-level."
        >
          <input type="hidden" name="parent_event_id" value="" />
          <Select id="parent_event_id" defaultValue="" disabled>
            <option value="">Top-level event (has sub-events)</option>
          </Select>
        </Field>
      ) : (
        <Field
          label="Belongs to (broader event)"
          htmlFor="parent_event_id"
          hint="Leave as “None” for a standalone/top-level event. Pick a broader event to make this a sub-event of it."
        >
          <Select
            id="parent_event_id"
            name="parent_event_id"
            defaultValue={event?.parent_event_id ?? defaultParentId ?? ""}
          >
            <option value="">None — top-level event</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </Field>
      )}

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
