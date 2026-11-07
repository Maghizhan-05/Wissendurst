import { z } from "zod";

/**
 * Schedule page wording (0031, site_settings.schedule). Only words are
 * editable; event titles, dates, times, venues, categories, links and order
 * always come from the events themselves.
 */

export const SCHEDULE_FIELDS = [
  { key: "metaTitle", label: "Browser tab title", max: 60, multiline: false },
  { key: "metaDescription", label: "Search description", max: 160, multiline: true },
  { key: "eyebrow", label: "Eyebrow", max: 40, multiline: false },
  { key: "heading", label: "Heading", max: 80, multiline: false },
  { key: "description", label: "Introduction", max: 300, multiline: true },
  { key: "tbaHeading", label: "“To be announced” day heading", max: 40, multiline: false },
  { key: "missingTime", label: "Label when an end time isn't set", max: 20, multiline: false },
  { key: "endPrefix", label: "Word before the end time", max: 20, multiline: false },
  { key: "emptyTitle", label: "Empty schedule — title", max: 60, multiline: false },
  { key: "emptyDescription", label: "Empty schedule — description", max: 200, multiline: true },
] as const;

export type ScheduleKey = (typeof SCHEDULE_FIELDS)[number]["key"];
export type ScheduleContent = Record<ScheduleKey, string>;

export const DEFAULT_SCHEDULE: ScheduleContent = {
  metaTitle: "Schedule",
  metaDescription: "The full Wissendurst'27 programme, day by day.",
  eyebrow: "Schedule",
  heading: "Three days, mapped out.",
  description: "Times are indicative and may shift slightly. Open any event to register.",
  tbaHeading: "To be announced",
  missingTime: "TBA",
  endPrefix: "until",
  emptyTitle: "Schedule coming soon",
  emptyDescription: "Events will appear here as they're announced.",
};

// Plain text: no control characters other than newlines in multi-line fields.
const singleLine = /^[^\u0000-\u001f\u007f]*$/;
const multiLine = /^[^\u0000-\u0009\u000b-\u001f\u007f]*$/;

export const scheduleSchema = z
  .object(
    Object.fromEntries(
      SCHEDULE_FIELDS.map((f) => [
        f.key,
        z
          .string()
          .trim()
          .min(1, `${f.label} can't be empty`)
          .max(f.max, `${f.label} can be at most ${f.max} characters`)
          .regex(f.multiline ? multiLine : singleLine, `${f.label} can't contain control characters`),
      ]),
    ) as Record<ScheduleKey, z.ZodString>,
  )
  .strict();

/**
 * Stored value → wording. Each field falls back to its default on its own
 * when missing or invalid, so a bad value never breaks the page.
 */
export function mergeSchedule(raw: unknown): ScheduleContent {
  const out: ScheduleContent = { ...DEFAULT_SCHEDULE };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const shape = scheduleSchema.shape;
  for (const f of SCHEDULE_FIELDS) {
    const parsed = shape[f.key].safeParse((raw as Record<string, unknown>)[f.key]);
    if (parsed.success) out[f.key] = parsed.data;
  }
  return out;
}
