"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/field";
import { setEventAdminAccess } from "@/lib/actions/event-admin";
import type { AdminActionState } from "@/lib/actions/admin";
import {
  EVENT_PERMISSIONS,
  EVENT_PERMISSION_LABELS,
  type EventPermission,
} from "@/lib/constants";

export interface EventAccessRow {
  eventId: string;
  title: string;
  archived: boolean;
  permissions: EventPermission[];
}

/**
 * Super admin: per-event administration of one account (0034). Additive to
 * the global Admin access above — it never changes the role, scopes or
 * participant ID.
 */
export function EventAdminAccessEditor({
  userId,
  assignments,
  assignable,
}: {
  userId: string;
  assignments: EventAccessRow[];
  /** Events (without sub-events) not yet assigned to this account. */
  assignable: { id: string; title: string; archived: boolean }[];
}) {
  return (
    <div className="space-y-4">
      {assignments.length === 0 ? (
        <p className="text-sm text-muted">No events assigned.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {assignments.map((a) => (
            <li key={a.eventId} className="p-3">
              <AssignmentForm userId={userId} row={a} />
            </li>
          ))}
        </ul>
      )}
      {assignable.length > 0 && <AddAssignmentForm userId={userId} assignable={assignable} />}
    </div>
  );
}

function PermissionBoxes({
  idPrefix,
  checked,
}: {
  idPrefix: string;
  checked: EventPermission[];
}) {
  return (
    <fieldset className="flex flex-wrap gap-4">
      <legend className="sr-only">Permissions</legend>
      {EVENT_PERMISSIONS.map((p) => (
        <label key={p} htmlFor={`${idPrefix}-${p}`} className="flex items-center gap-2 text-sm text-foreground">
          <input
            id={`${idPrefix}-${p}`}
            type="checkbox"
            name="permissions"
            value={p}
            defaultChecked={checked.includes(p)}
            className="size-4 accent-[var(--brand)]"
          />
          {EVENT_PERMISSION_LABELS[p]}
        </label>
      ))}
    </fieldset>
  );
}

function Message({ state }: { state: AdminActionState }) {
  return (
    <p role="status" aria-live="polite" className="text-xs">
      {state && !state.ok && <span className="text-alert">{state.error}</span>}
      {state?.ok && state.message && <span className="text-success">{state.message}</span>}
    </p>
  );
}

function AssignmentForm({ userId, row }: { userId: string; row: EventAccessRow }) {
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(
    setEventAdminAccess,
    null,
  );
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="event_id" value={row.eventId} />
      <p className="text-sm font-medium text-foreground">
        {row.title}
        {row.archived && <span className="ml-2 text-xs text-muted">(archived)</span>}
      </p>
      <PermissionBoxes idPrefix={`ea-${row.eventId}`} checked={row.permissions} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Save
        </Button>
        <span className="text-xs text-muted">Untick both and save to remove.</span>
      </div>
      <Message state={state} />
    </form>
  );
}

function AddAssignmentForm({
  userId,
  assignable,
}: {
  userId: string;
  assignable: { id: string; title: string; archived: boolean }[];
}) {
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(
    setEventAdminAccess,
    null,
  );
  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-dashed border-border p-3">
      <input type="hidden" name="user_id" value={userId} />
      <div>
        <Label htmlFor="event-admin-event">Add an event</Label>
        <Select id="event-admin-event" name="event_id" required defaultValue="">
          <option value="" disabled>
            Choose an event…
          </option>
          {assignable.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
              {e.archived ? " (archived)" : ""}
            </option>
          ))}
        </Select>
      </div>
      <PermissionBoxes idPrefix="ea-new" checked={["events"]} />
      <Button type="submit" size="sm" loading={pending}>
        Assign event
      </Button>
      <Message state={state} />
    </form>
  );
}
