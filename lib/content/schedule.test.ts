import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SCHEDULE, SCHEDULE_FIELDS, mergeSchedule, scheduleSchema } from "./schedule.ts";

test("schedule wording: defaults cover every field", () => {
  for (const f of SCHEDULE_FIELDS) {
    assert.ok(DEFAULT_SCHEDULE[f.key].length > 0 && DEFAULT_SCHEDULE[f.key].length <= f.max, f.key);
  }
  assert.equal(scheduleSchema.safeParse(DEFAULT_SCHEDULE).success, true);
});

test("schedule wording: validation", () => {
  const ok = { ...DEFAULT_SCHEDULE, heading: "  Four days, mapped out.  " };
  const parsed = scheduleSchema.safeParse(ok);
  assert.equal(parsed.success && parsed.data.heading, "Four days, mapped out.");
  assert.equal(scheduleSchema.safeParse({ ...DEFAULT_SCHEDULE, heading: "" }).success, false);
  assert.equal(scheduleSchema.safeParse({ ...DEFAULT_SCHEDULE, heading: "x".repeat(81) }).success, false);
  assert.equal(scheduleSchema.safeParse({ ...DEFAULT_SCHEDULE, heading: "a\nb" }).success, false);
  assert.equal(scheduleSchema.safeParse({ ...DEFAULT_SCHEDULE, description: "line one\nline two" }).success, true);
  assert.equal(scheduleSchema.safeParse({ ...DEFAULT_SCHEDULE, extra: "x" }).success, false);
  const { heading: _drop, ...missing } = DEFAULT_SCHEDULE;
  void _drop;
  assert.equal(scheduleSchema.safeParse(missing).success, false);
});

test("schedule wording: merge falls back per field", () => {
  assert.deepEqual(mergeSchedule(null), DEFAULT_SCHEDULE);
  assert.deepEqual(mergeSchedule([]), DEFAULT_SCHEDULE);
  assert.deepEqual(mergeSchedule("x"), DEFAULT_SCHEDULE);
  const m = mergeSchedule({ heading: "Custom", eyebrow: "", tbaHeading: 42, endPrefix: "till", extra: 1 });
  assert.equal(m.heading, "Custom");
  assert.equal(m.eyebrow, DEFAULT_SCHEDULE.eyebrow);
  assert.equal(m.tbaHeading, DEFAULT_SCHEDULE.tbaHeading);
  assert.equal(m.endPrefix, "till");
  assert.equal(m.description, DEFAULT_SCHEDULE.description);
});
