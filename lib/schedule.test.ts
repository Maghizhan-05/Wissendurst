// Unit tests — run with `npm run test:unit` (node --test, no build step).
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareScheduleEvents, type ScheduleSortable } from "./schedule.ts";

const ev = (id: string, title: string, start_time: string | null = null): ScheduleSortable => ({ id, title, start_time });
const order = (list: ScheduleSortable[]) => list.slice().sort(compareScheduleEvents).map((e) => e.id);

test("within a day: start time, then title, then id", () => {
  const list = [ev("5", "Zeta", "14:00"), ev("4", "Alpha", "14:00"), ev("3", "Beta", "09:30"), ev("2", "Same", "09:30"), ev("1", "Same", "09:30")];
  assert.deepEqual(order(list), ["3", "1", "2", "4", "5"]);
});

test("undated/TBA events with no start time sort alphabetically, independent of input order", () => {
  const a = [ev("b", "Quizzes"), ev("a", "Med Poster")];
  assert.deepEqual(order(a), ["a", "b"]);
  assert.deepEqual(order(a.slice().reverse()), ["a", "b"]);
});

test("events without a start time keep coming before timed ones (unchanged)", () => {
  assert.deepEqual(order([ev("t", "Timed", "08:00"), ev("n", "Zulu")]), ["n", "t"]);
});
