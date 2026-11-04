"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { saveGeneralRegistrationEvents, type GrActionState } from "@/lib/actions/general-registration";
import { formatINR } from "@/lib/utils";

type Option = {
  id: string;
  title: string;
  slug: string;
  archived_at: string | null;
  general_registration_covered: boolean;
  registration_fee: number;
  team_enabled: boolean;
};

export function GeneralRegistrationEventsForm({ options }: { options: Option[] }) {
  const [state, action, pending] = useActionState<GrActionState, FormData>(saveGeneralRegistrationEvents, null);
  useEffect(() => {
    if (state?.ok) toast.success(state.message);
    else if (state && !state.ok) toast.error(state.error);
  }, [state]);

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold text-foreground">Included events</h2>
        <p className="mt-0.5 text-sm text-muted">
          Participants without General Registration can&rsquo;t register or pay for these individually.
          Verified participants enrol in each one for free (capacity and team rules still apply).
        </p>
      </div>
      <form action={action} className="space-y-4">
        <fieldset>
          <legend className="sr-only">Events included in General Registration</legend>
          {options.length === 0 ? (
            <p className="text-sm text-muted">No events available.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-auto rounded-xl border border-border">
              {options.map((o) => (
                <li key={o.id}>
                  <label className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2/40">
                    <span className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        name="event_id"
                        value={o.id}
                        defaultChecked={o.general_registration_covered}
                        className="size-4 accent-[var(--brand)]"
                      />
                      <span className="text-sm font-medium text-foreground">{o.title}</span>
                      {o.team_enabled && <span className="text-xs text-muted">Team</span>}
                      {o.archived_at && <span className="text-xs text-warning">Archived</span>}
                    </span>
                    <span className="font-mono text-xs text-muted">{formatINR(o.registration_fee)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        <div className="flex justify-end">
          <Button type="submit" loading={pending}>
            Save included events
          </Button>
        </div>
      </form>
    </Card>
  );
}
