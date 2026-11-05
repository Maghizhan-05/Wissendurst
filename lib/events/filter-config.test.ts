// Unit tests — run with `npm run test:unit` (node --test, no build step).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SEED_EVENT_CATEGORIES, type EventCategoryInfo } from "./categories.ts";
import {
  defaultEventFilterConfig,
  matchesFilter,
  resolveActiveFilter,
  resolveEventFilterConfig,
  shadowedCategory,
  slugifyLabel,
  unassignedCategories,
  validateEventFilterConfig,
  visibleGroups,
  type EventFilterConfig,
} from "./filter-config.ts";

// The seven seeded categories with database-style UUIDs.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CATS: EventCategoryInfo[] = SEED_EVENT_CATEGORIES.map((c, i) => ({ ...c, id: uuid(i + 1) }));
const id = (slug: string) => CATS.find((c) => c.slug === slug)!.id;
const DEFAULT = defaultEventFilterConfig(CATS);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const cfg = (groups: Partial<EventFilterConfig["groups"][number]>[], allLabel = "All"): EventFilterConfig => ({
  allLabel,
  groups: groups.map((g, i) => ({
    id: `g${i + 1}`, slug: `g${i + 1}`, label: `G${i + 1}`, enabled: true, position: i + 1, categories: [id("workshop")], ...g,
  })) as EventFilterConfig["groups"],
});

test("default reproduces the pre-0025 bar exactly (All + seven categories in order)", () => {
  assert.equal(DEFAULT.allLabel, "All");
  assert.deepEqual(visibleGroups(DEFAULT).map((g) => g.label), CATS.map((c) => c.label));
  assert.deepEqual(DEFAULT.groups.map((g) => g.slug), CATS.map((c) => c.slug));
  assert.ok(validateEventFilterConfig(DEFAULT, { categories: CATS }).ok);
  assert.deepEqual(unassignedCategories(DEFAULT, CATS), []);
});

test("default equals the 0025 SQL seed once slugs map to category ids", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../../supabase/migrations/0025_event_filter_config.sql", import.meta.url), "utf8");
  const seed = JSON.parse(sql.split("$j$")[1]);
  seed.groups = seed.groups.map((g: { categories: string[] }) => ({ ...g, categories: g.categories.map(id) }));
  assert.deepEqual(seed, DEFAULT);
});

test("default skips archived categories and caps at seven tabs", () => {
  const many = [...CATS.map((c) => (c.slug === "debate" ? { ...c, archived_at: "2026-11-05" } : c)),
    { ...CATS[0], id: uuid(8), slug: "quiz", label: "Quiz", position: 8 }];
  const d = defaultEventFilterConfig(many);
  assert.equal(d.groups.length, 7);
  assert.ok(!d.groups.some((g) => g.slug === "debate"));
  assert.equal(d.groups[6].slug, "quiz");
});

test("groups are unions and may overlap", () => {
  const c = cfg([
    { slug: "presentations", categories: [id("poster"), id("paper")] },
    { slug: "research", categories: [id("paper"), id("academic")] },
  ]);
  assert.ok(validateEventFilterConfig(c, { categories: CATS }).ok);
  const pres = resolveActiveFilter(c, CATS, "presentations");
  const res = resolveActiveFilter(c, CATS, "research");
  assert.equal(matchesFilter(pres, id("poster")), true);
  assert.equal(matchesFilter(pres, id("paper")), true);
  assert.equal(matchesFilter(pres, id("debate")), false);
  assert.equal(matchesFilter(res, id("paper")), true); // paper in both
  assert.equal(matchesFilter({ kind: "all" }, id("other")), true);
  assert.equal(matchesFilter(pres, undefined), false);
});

test("unassigned (active) categories are reported and stay reachable via All", () => {
  const c = cfg([{ categories: [id("workshop")] }, { categories: [id("debate")], enabled: false }]);
  assert.deepEqual(unassignedCategories(c, CATS).map((x) => x.slug), ["debate", "poster", "paper", "competition", "academic", "other"]);
  const archivedDebate = CATS.map((x) => (x.slug === "debate" ? { ...x, archived_at: "2026-11-05" } : x));
  assert.ok(!unassignedCategories(c, archivedDebate).some((x) => x.slug === "debate"), "archived categories aren't nagged about");
  assert.equal(matchesFilter(resolveActiveFilter(c, CATS, null), id("other")), true);
});

test("disabled groups are hidden and their slugs don't resolve", () => {
  const c = cfg([{ slug: "skills", enabled: false, categories: [id("competition"), id("debate")] }, { slug: "ws" }]);
  assert.deepEqual(visibleGroups(c).map((g) => g.slug), ["ws"]);
  assert.deepEqual(resolveActiveFilter(c, CATS, "skills"), { kind: "all" });
});

test("legacy ?category= links keep working", () => {
  const d = resolveActiveFilter(DEFAULT, CATS, "workshop");
  assert.equal(d.kind === "group" && d.group.id, "workshop");
  // renamed single-category group still highlights
  const renamed = cfg([{ slug: "hands-on", label: "Hands-on", categories: [id("workshop")] }]);
  const r = resolveActiveFilter(renamed, CATS, "workshop");
  assert.equal(r.kind === "group" && r.group.slug, "hands-on");
  // category only inside a multi-category group -> exact category filter
  const merged = cfg([{ slug: "presentations", categories: [id("poster"), id("paper")] }]);
  const poster = resolveActiveFilter(merged, CATS, "poster");
  assert.equal(poster.kind === "category" && poster.category.slug, "poster");
  assert.equal(matchesFilter(poster, id("paper")), false);
  // a tab can't hide a category's link: an unrelated tab with slug "workshop" doesn't win (0029)
  const live = cfg([{ id: "poster", slug: "workshop", label: "Workshops", categories: [id("poster")] }]);
  const w = resolveActiveFilter(live, CATS, "workshop");
  assert.equal(w.kind === "category" && w.category.slug, "workshop");
  // archived categories still resolve (old links), unknown/"all" fall back to All
  const archived = CATS.map((x) => (x.slug === "paper" ? { ...x, archived_at: "2026-11-05" } : x));
  const a = resolveActiveFilter(cfg([]), archived, "paper");
  assert.equal(a.kind === "category" && a.category.slug, "paper");
  assert.equal(resolveActiveFilter(DEFAULT, CATS, "DEBATE").kind, "group");
  assert.deepEqual(resolveActiveFilter(DEFAULT, CATS, "nonsense"), { kind: "all" });
  assert.deepEqual(resolveActiveFilter(DEFAULT, CATS, "all"), { kind: "all" });
});

test("malformed or absent stored data falls back to the default", () => {
  for (const bad of [null, undefined, 42, "x", [], {}, { allLabel: "All" }, { allLabel: "All", groups: "x" },
    { allLabel: "", groups: [] }, { ...clone(DEFAULT), extra: 1 },
    cfg([{ categories: ["workshop"] }]), // pre-0027 slug reference
    cfg([{ categories: [uuid(99)] }])]) // nonexistent category
    assert.deepEqual(resolveEventFilterConfig(bad, CATS), DEFAULT, JSON.stringify(bad));
  const ok = cfg([{ label: "Mine" }], "Everything");
  assert.deepEqual(resolveEventFilterConfig(ok, CATS), ok);
});

test("archived categories: kept where they were, never newly added", () => {
  const archived = CATS.map((x) => (x.slug === "paper" ? { ...x, archived_at: "2026-11-05" } : x));
  const before = cfg([{ id: "pres", slug: "pres", categories: [id("poster"), id("paper")] }, { id: "ws", slug: "ws" }]);
  // public read accepts existing archived references
  assert.deepEqual(resolveEventFilterConfig(before, archived), before);
  // re-save keeps it
  assert.ok(validateEventFilterConfig(before, { categories: archived, previous: before }).ok);
  // removing it is fine
  const removed = cfg([{ id: "pres", slug: "pres", categories: [id("poster")] }, { id: "ws", slug: "ws" }]);
  assert.ok(validateEventFilterConfig(removed, { categories: archived, previous: before }).ok);
  // adding it to another group, or after removal, is not
  const moved = cfg([{ id: "pres", slug: "pres", categories: [id("poster"), id("paper")] }, { id: "ws", slug: "ws", categories: [id("paper")] }]);
  assert.equal(validateEventFilterConfig(moved, { categories: archived, previous: before }).ok, false);
  assert.equal(validateEventFilterConfig(before, { categories: archived, previous: removed }).ok, false);
  assert.equal(validateEventFilterConfig(before, { categories: archived, previous: null }).ok, false);
});

test("validation rejects duplicates, bad slugs, limits, ordering and unknown categories", () => {
  const reject = (c: unknown, re: RegExp) => {
    const v = validateEventFilterConfig(c, { categories: CATS });
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
  reject(cfg([{ categories: [id("workshop"), id("workshop")] }]), /Duplicate category/);
  reject(cfg([{ categories: ["cooking"] }]), /Unknown category/);
  reject(cfg([{ categories: [uuid(99)] }]), /no longer exists/);
  reject(cfg([{ position: 2 }]), /Positions/);
  reject(cfg(Array.from({ length: 8 }, (_, i) => ({ id: `g${i}`, slug: `g${i}` }))), /At most 7/);
  reject({ ...cfg([]), allLabel: "x".repeat(41) }, /1–40/);
  reject({ ...cfg([{}]), groups: [{ ...cfg([{}]).groups[0], color: "red" }] }, /./);
  assert.ok(validateEventFilterConfig(cfg([]), { categories: CATS }).ok, "zero groups is valid (All only)");
});

test("slugifyLabel produces valid slugs", () => {
  assert.equal(slugifyLabel("Poster & Paper Presentations"), "poster-paper-presentations");
  assert.equal(slugifyLabel("  Café  Talks! "), "cafe-talks");
});

test("a tab may use a category's slug only when it shows exactly that category", () => {
  // the pre-reset live shape: tab "workshop" showed Poster Presentation
  const live = cfg([{ id: "workshop", slug: "quizzes", categories: [id("workshop")] }, { id: "poster", slug: "workshop", label: "Workshops", categories: [id("poster")] }]);
  assert.equal(shadowedCategory(live.groups[1], CATS)?.slug, "workshop");
  assert.equal(shadowedCategory(live.groups[0], CATS), null);
  assert.equal(validateEventFilterConfig(live, { categories: CATS, previous: live }).ok, false, "no grandfathering");
  assert.equal(validateEventFilterConfig(live, { categories: CATS, previous: null }).ok, false);
  const taken = cfg([{ id: "workshop", slug: "debate", categories: [id("workshop")] }]);
  const r = validateEventFilterConfig(taken, { categories: CATS, previous: null });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /belongs to the category “Debate”/);
  const exact = cfg([{ id: "papers", slug: "paper", categories: [id("paper")] }]);
  assert.ok(validateEventFilterConfig(exact, { categories: CATS, previous: null }).ok);
  assert.ok(validateEventFilterConfig(DEFAULT, { categories: CATS, previous: null }).ok, "default never shadows");
  // even if such a config were read, ?category=workshop opens the Workshop category
  const w = resolveActiveFilter(live, CATS, "workshop");
  assert.equal(w.kind === "group" ? w.group.id : w.kind === "category" ? w.category.slug : "all", "workshop");
  assert.equal(matchesFilter(w, id("workshop")), true);
  assert.equal(matchesFilter(w, id("poster")), false);
});

test("every category URL opens that category or a one-category tab containing it", () => {
  const configs = [DEFAULT, cfg([{ slug: "presentations", categories: [id("poster"), id("paper")] }]),
    cfg([{ id: "x", slug: "workshop", categories: [id("poster")] }, { id: "y", slug: "hands-on", categories: [id("workshop")] }])];
  for (const c of configs)
    for (const cat of CATS) {
      const f = resolveActiveFilter(c, CATS, cat.slug);
      const ok = f.kind === "category" ? f.category.id === cat.id : f.kind === "group" && f.group.categories.length === 1 && f.group.categories[0] === cat.id;
      assert.ok(ok, `${cat.slug} in ${JSON.stringify(c.groups.map((g) => g.slug))}`);
    }
});
