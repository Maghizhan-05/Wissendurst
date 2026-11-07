"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/field";
import { updateScheduleContent, type ContentState } from "@/lib/actions/content";
import {
  DEFAULT_SCHEDULE,
  SCHEDULE_FIELDS,
  scheduleSchema,
  type ScheduleContent,
  type ScheduleKey,
} from "@/lib/content/schedule";
import { cn } from "@/lib/utils";

const GROUPS: { title: string; keys: ScheduleKey[] }[] = [
  { title: "Browser and search", keys: ["metaTitle", "metaDescription"] },
  { title: "Page header", keys: ["eyebrow", "heading", "description"] },
  { title: "Event list", keys: ["tbaHeading", "endPrefix", "missingTime"] },
  { title: "When no events are published", keys: ["emptyTitle", "emptyDescription"] },
];

export function ScheduleEditor({ initial }: { initial: ScheduleContent }) {
  const [values, setValues] = useState<ScheduleContent>(initial);
  const [state, formAction, pending] = useActionState<ContentState, FormData>(updateScheduleContent, null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(state.message);
    else toast.error(state.error);
  }, [state]);

  const parsed = scheduleSchema.safeParse(values);
  const errors = new Map<string, string>();
  if (!parsed.success) for (const i of parsed.error.issues) errors.set(String(i.path[0]), i.message);
  const isDefault = SCHEDULE_FIELDS.every((f) => values[f.key] === DEFAULT_SCHEDULE[f.key]);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="schedule" value={JSON.stringify(values)} />
      {GROUPS.map((g) => (
        <Card key={g.title} className="space-y-4">
          <h2 className="font-display text-lg font-semibold text-foreground">{g.title}</h2>
          {g.keys.map((key) => {
            const f = SCHEDULE_FIELDS.find((x) => x.key === key)!;
            const id = `schedule-${key}`;
            const err = errors.get(key);
            const Control = f.multiline ? Textarea : Input;
            return (
              <div key={key}>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor={id}>{f.label}</Label>
                  <button
                    type="button"
                    onClick={() => setValues((v) => ({ ...v, [key]: DEFAULT_SCHEDULE[key] }))}
                    disabled={values[key] === DEFAULT_SCHEDULE[key]}
                    aria-label={`Reset ${f.label} to default`}
                    title="Reset to default"
                    className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-30"
                  >
                    <RotateCcw className="size-4" aria-hidden />
                  </button>
                </div>
                <Control
                  id={id}
                  value={values[key]}
                  onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                    setValues((v) => ({ ...v, [key]: e.target.value }))
                  }
                  maxLength={f.max + 20}
                  rows={f.multiline ? 3 : undefined}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={`${id}-hint`}
                  className={cn(err && "border-alert focus-visible:outline-alert")}
                />
                <p
                  id={`${id}-hint`}
                  className={cn("mt-1 flex justify-between gap-3 text-xs", err ? "text-alert" : "text-muted")}
                >
                  <span className="min-w-0 break-words">{err ?? `Default: ${DEFAULT_SCHEDULE[key]}`}</span>
                  <span className="shrink-0 font-mono">
                    {values[key].trim().length}/{f.max}
                  </span>
                </p>
              </div>
            );
          })}
        </Card>
      ))}

      {errors.size > 0 && (
        <p role="alert" className="rounded-lg border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert">
          Fix {errors.size} field{errors.size === 1 ? "" : "s"} before saving.
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={isDefault}
          onClick={() => setValues({ ...DEFAULT_SCHEDULE })}
        >
          <RotateCcw className="size-4" aria-hidden /> Reset all to defaults
        </Button>
        <Button type="submit" loading={pending} disabled={errors.size > 0}>
          Save schedule page
        </Button>
      </div>
    </form>
  );
}
