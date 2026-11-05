// Unit tests — run with `npm run test:unit` (node --test, no build step).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT_CATEGORIES, EVENT_CATEGORY_LABELS } from "../constants.ts";
import {
  DEFAULT_EVENT_FILTER_CONFIG,
  matchesFilter,
  resolveActiveFilter,
  resolveEventFilterConfig,
  slugifyLabel,
  unassignedCategories,
  validateEventFilterConfig,
  visibleGroups,
  type EventFilterConfig,
} from "./filter-config.ts";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const cfg = (groups: Partial<EventFilterConfig["groups"][number]>[], allLabel = "All"): EventFilterConfig => ({
  allLabel,
  groups: groups.map((g, i) => ({
    id: `g${i + 1}`, slug: `g${i + 1}`, label: `G${i + 1}`, enabled: true, position: i + 1, categories: ["workshop"], ...g,
  })) as EventFilterConfig["groups"],
});

test("default reproduces the pre-0025 bar exactly (All + seven categories in order)", () => {
  assert.equal(DEFAULT_EVENT_FILTER_CONFIG.allLabel, "All");
  assert.deepEqual(visibleGroups(DEFAULT_EVENT_FILTER_CONFIG).map((g) => g.label), EVENT_CATEGORIES.map((c) => EVENT_CATEGORY_LABELS[c]));
  assert.deepEqual(DEFAULT_EVENT_FILTER_CONFIG.groups.map((g) => g.slug), [...EVENT_CATEGORIES]);
  assert.ok(validateEventFilterConfig(DEFAULT_EVENT_FILTER_CONFIG).ok);
  assert.deepEqual(unassignedCategories(DEFAULT_EVENT_FILTER_CONFIG), []);
});

test("default equals the SQL seed in 0025", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../../supabase/migrations/0025_event_filter_config.sql", import.meta.url), "utf8");
  const seed = JSON.parse(sql.split("$j$")[1]);
  assert.deepEqual(seed, DEFAULT_EVENT_FILTER_CONFIG);
});

test("groups are unions and may overlap", () => {
  const c = cfg([
    { slug: "presentations", categories: ["poster", "paper"] },
    { slug: "research", categories: ["paper", "academic"] },
  ]);
  assert.ok(validateEventFilterConfig(c).ok);
  const pres = resolveActiveFilter(c, "presentations");
  const res = resolveActiveFilter(c, "research");
  assert.equal(matchesFilter(pres, "poster"), true);
  assert.equal(matchesFilter(pres, "paper"), true);
  assert.equal(matchesFilter(pres, "debate"), false);
  assert.equal(matchesFilter(res, "paper"), true); // paper in both
  assert.equal(matchesFilter({ kind: "all" }, "other"), true);
});

test("unassigned categories are reported and stay reachable via All", () => {
  const c = cfg([{ categories: ["workshop"] }, { categories: ["debate"], enabled: false }]);
  assert.deepEqual(unassignedCategories(c), ["debate", "poster", "paper", "competition", "academic", "other"]);
  assert.equal(matchesFilter(resolveActiveFilter(c, null), "other"), true);
});

test("disabled groups are hidden and their slugs don't resolve", () => {
  const c = cfg([{ slug: "skills", enabled: false, categories: ["competition", "debate"] }, { slug: "ws" }]);
  assert.deepEqual(visibleGroups(c).map((g) => g.slug), ["ws"]);
  assert.deepEqual(resolveActiveFilter(c, "skills"), { kind: "all" });
});

test("legacy ?category= links keep working", () => {
  // default: category slug == group slug
  const d = resolveActiveFilter(DEFAULT_EVENT_FILTER_CONFIG, "workshop");
  assert.equal(d.kind === "group" && d.group.id, "workshop");
  // renamed single-category group still highlights
  const renamed = cfg([{ slug: "hands-on", label: "Hands-on", categories: ["workshop"] }]);
  const r = resolveActiveFilter(renamed, "workshop");
  assert.equal(r.kind === "group" && r.group.slug, "hands-on");
  // category only inside a multi-category group -> exact category filter
  const merged = cfg([{ slug: "presentations", categories: ["poster", "paper"] }]);
  assert.deepEqual(resolveActiveFilter(merged, "poster"), { kind: "category", category: "poster" });
  assert.equal(matchesFilter(resolveActiveFilter(merged, "poster"), "paper"), false);
  // case-insensitive, unknown and "all" fall back to All
  assert.equal(resolveActiveFilter(DEFAULT_EVENT_FILTER_CONFIG, "DEBATE").kind, "group");
  assert.deepEqual(resolveActiveFilter(DEFAULT_EVENT_FILTER_CONFIG, "nonsense"), { kind: "all" });
  assert.deepEqual(resolveActiveFilter(DEFAULT_EVENT_FILTER_CONFIG, "all"), { kind: "all" });
});

test("malformed or absent stored data falls back to the default", () => {
  for (const bad of [null, undefined, 42, "x", [], {}, { allLabel: "All" }, { allLabel: "All", groups: "x" },
    { allLabel: "", groups: [] }, { ...clone(DEFAULT_EVENT_FILTER_CONFIG), extra: 1 }])
    assert.deepEqual(resolveEventFilterConfig(bad), DEFAULT_EVENT_FILTER_CONFIG, JSON.stringify(bad));
  const ok = cfg([{ label: "Mine" }], "Everything");
  assert.deepEqual(resolveEventFilterConfig(ok), ok);
});

test("validation rejects duplicates, bad slugs, limits, ordering and unknown categories", () => {
  const reject = (c: unknown, re: RegExp) => {
    const v = validateEventFilterConfig(c);
    assert.equal(v.ok, false, JSON.stringify(c));
    if (!v.ok) assert.match(v.error, re);
  };
  reject(cfg([{ id: "a" }, { id: "a" }]), /Duplicate group id/);
  reject(cfg([{ slug: "x" }, { slug: "x" }]), /used twice/);
  reject(cfg([{ slug: "all" }]), /reserved/);
  reject(cfg([{ slug: "Bad Slug" }]), /Slug may use/);
  reject(cfg([{ slug: "a--b" }]), /Slug may use/);
  reject(cfg([{ slug: "a".repeat(41) }]), /at most 40/);
  reject(cfg([{ label: "" }]), /1–40/);
  reject(cfg([{ label: "x".repeat(41) }]), /1–40/);
  reject(cfg([{ label: " padded" }]), /spaces/);
  reject(cfg([{ categories: [] }]), /at least one/);
  reject(cfg([{ categories: ["workshop", "workshop"] }]), /Duplicate category/);
  reject(cfg([{ categories: ["cooking" as never] }]), /./);
  reject(cfg([{ position: 2 }]), /Positions/);
  reject(cfg(Array.from({ length: 8 }, (_, i) => ({ id: `g${i}`, slug: `g${i}` }))), /At most 7/);
  reject({ ...cfg([]), allLabel: "x".repeat(41) }, /1–40/);
  reject({ ...cfg([{}]), groups: [{ ...cfg([{}]).groups[0], color: "red" }] }, /./);
  assert.ok(validateEventFilterConfig(cfg([])).ok, "zero groups is valid (All only)");
});

test("slugifyLabel produces valid slugs", () => {
  assert.equal(slugifyLabel("Poster & Paper Presentations"), "poster-paper-presentations");
  assert.equal(slugifyLabel("  Café  Talks! "), "cafe-talks");
});
