import { test } from "node:test";
import assert from "node:assert/strict";
import { adjustedPrice, draftsFromWindows, fromIstLocal, parseWindowDrafts, toIstLocal } from "./price-windows.ts";

test("India-time conversion round-trips", () => {
  assert.equal(fromIstLocal("2026-11-07T10:00"), "2026-11-07T10:00:00+05:30");
  assert.equal(toIstLocal("2026-11-07T04:30:00Z"), "2026-11-07T10:00");
  assert.equal(toIstLocal(fromIstLocal("2026-12-31T23:59")), "2026-12-31T23:59");
  assert.equal(fromIstLocal("2026-11-07"), null);
  assert.equal(toIstLocal(null), "");
});

test("window drafts validate like the database", () => {
  const base = draftsFromWindows([]);
  assert.deepEqual(parseWindowDrafts(base), { ok: true, windows: [] });
  const set = (kind: string, patch: object) => base.map((d) => (d.kind === kind ? { ...d, enabled: true, ...patch } : d));
  const ok = parseWindowDrafts(set("early_bird", { start: "2026-11-01T00:00", end: "2026-11-10T00:00", rupees: "-20" }));
  assert.deepEqual(ok, { ok: true, windows: [{ kind: "early_bird", starts_at: "2026-11-01T00:00:00+05:30", ends_at: "2026-11-10T00:00:00+05:30", adjustment: -2000 }] });
  assert.equal(parseWindowDrafts(set("on_spot", { rupees: "1" })).ok, true);
  const bad = parseWindowDrafts(set("late_bird", { start: "2026-11-10T00:00", end: "2026-11-01T00:00", rupees: "1" }));
  assert.equal(!bad.ok && bad.errors.late_bird, "Late bird: the end must be after the start.");
  assert.equal(parseWindowDrafts(set("on_spot", { rupees: "1.5" })).ok, false);
  const overlap = parseWindowDrafts(
    base.map((d) =>
      d.kind === "early_bird" ? { ...d, enabled: true, start: "2026-11-01T00:00", end: "2026-11-10T00:00", rupees: "-20" }
      : d.kind === "late_bird" ? { ...d, enabled: true, start: "2026-11-09T00:00", end: "2026-11-12T00:00", rupees: "1" } : d,
    ),
  );
  assert.equal(!overlap.ok && overlap.errors.late_bird, "Early bird and late bird can't overlap.");
});

test("adjusted price is per person and never below zero", () => {
  assert.equal(adjustedPrice(30000, 100, 3), 30300);
  assert.equal(adjustedPrice(30000, -2000, 3), 24000);
  assert.equal(adjustedPrice(5000, -10000, 1), 0);
});
