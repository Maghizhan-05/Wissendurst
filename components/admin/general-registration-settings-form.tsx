"use client";

import { useActionState, useEffect, useId } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/field";
import { saveGeneralRegistrationSettings, type GrActionState } from "@/lib/actions/general-registration";
import type { GeneralRegistrationSettingsRow } from "@/types/database";

export function GeneralRegistrationSettingsForm({
  settings,
  eventUpiIds,
}: {
  settings: GeneralRegistrationSettingsRow;
  /** Event/default UPI ids the dedicated GR UPI must differ from (hint only). */
  eventUpiIds: string[];
}) {
  const id = useId();
  const [state, action, pending] = useActionState<GrActionState, FormData>(saveGeneralRegistrationSettings, null);
  useEffect(() => {
    if (state?.ok) toast.success(state.message);
    else if (state && !state.ok) toast.error(state.error);
  }, [state]);

  return (
    <Card className="space-y-5">
      <div>
        <h2 className="font-display text-lg font-semibold text-foreground">Settings</h2>
        <p className="mt-0.5 text-sm text-muted">
          Changes apply to new General Registrations only — existing ones keep the fee and UPI they started with.
        </p>
      </div>
      <form action={action} className="space-y-4">
        <label htmlFor={`${id}-en`} className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            id={`${id}-en`}
            name="enabled"
            type="checkbox"
            defaultChecked={settings.enabled}
            className="size-4 accent-[var(--brand)]"
          />
          Open for participants
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${id}-fee`}>Fee (₹)</Label>
            <Input
              id={`${id}-fee`}
              name="fee"
              type="number"
              min={0}
              max={100000}
              step="0.01"
              inputMode="decimal"
              defaultValue={(settings.fee / 100).toString()}
              required
            />
          </div>
          <div>
            <Label htmlFor={`${id}-payee`}>Payee name</Label>
            <Input id={`${id}-payee`} name="payee_name" maxLength={100} defaultValue={settings.payee_name} />
          </div>
        </div>
        <div>
          <Label htmlFor={`${id}-upi`}>Dedicated UPI ID</Label>
          <Input
            id={`${id}-upi`}
            name="upi_id"
            maxLength={320}
            placeholder="name@bank"
            spellCheck={false}
            defaultValue={settings.upi_id ?? ""}
            aria-describedby={`${id}-upi-hint`}
            className="font-mono"
          />
          <p id={`${id}-upi-hint`} className="mt-1 text-xs text-muted">
            Must be a separate account: it can&rsquo;t match any event UPI ID or the site default
            {eventUpiIds.length > 0 ? ` (${eventUpiIds.join(", ")})` : ""}. There is no fallback.
          </p>
        </div>
        <div>
          <Label htmlFor={`${id}-desc`}>Page description</Label>
          <Textarea id={`${id}-desc`} name="description" rows={3} maxLength={2000} defaultValue={settings.description} />
        </div>
        <div>
          <Label htmlFor={`${id}-ins`}>Payment instructions</Label>
          <Textarea id={`${id}-ins`} name="instructions" rows={3} maxLength={2000} defaultValue={settings.instructions} />
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={pending}>
            Save settings
          </Button>
        </div>
      </form>
    </Card>
  );
}
