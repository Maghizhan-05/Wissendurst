// Unit tests — run with `npm run test:unit` (node --test, no build step).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CATEGORY_COLORS,
  CATEGORY_COLOR_KEYS,
  CATEGORY_ICON_KEYS,
  CATEGORY_ICON_LABELS,
  SEED_EVENT_CATEGORIES,
  categoryLabel,
  categoryVisual,
  linksToCategory,
  newCategorySchema,
  sanitizeCategories,
} from "./categories.ts";

const sql = readFileSync(new URL("../../supabase/migrations/0027_event_categories.sql", import.meta.url), "utf8");
const arrayAfter = (marker: string) => {
  const at = sql.indexOf(marker);
  const body = sql.slice(sql.indexOf("array[", at) + 6, sql.indexOf("]", sql.indexOf("array[", at)));
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

test("icon and tint allowlists match the database CHECK constraints", () => {
  assert.deepEqual(arrayAfter("icon_key    text not null check"), [...CATEGORY_ICON_KEYS]);
  assert.deepEqual(arrayAfter("color_key   text not null check"), [...CATEGORY_COLOR_KEYS]);
  // ... and the RPC re-check
  assert.deepEqual(arrayAfter("p_icon_key = any"), [...CATEGORY_ICON_KEYS]);
  assert.deepEqual(arrayAfter("p_color_key = any"), [...CATEGORY_COLOR_KEYS]);
  assert.deepEqual(Object.keys(CATEGORY_ICON_LABELS).sort(), [...CATEGORY_ICON_KEYS].sort());
  assert.deepEqual(Object.keys(CATEGORY_COLORS).sort(), [...CATEGORY_COLOR_KEYS].sort());
  for (const c of Object.values(CATEGORY_COLORS)) {
    assert.match(c.hex, /^#[0-9a-f]{6}$/);
    assert.match(c.hue, /^from-[a-z0-9-]+\/\d+$/);
  }
});

test("seed fallback equals the 0027 SQL seed", () => {
  const rows = [...sql.matchAll(/\('([a-z]+)',\s+'([^']+)',\s+(\d), '([a-z-]+)',\s+'([a-z-]+)'\)/g)].map((m) => ({
    slug: m[1], label: m[2], position: Number(m[3]), icon_key: m[4], color_key: m[5],
  }));
  assert.deepEqual(rows, SEED_EVENT_CATEGORIES.map(({ slug, label, position, icon_key, color_key }) => ({ slug, label, position, icon_key, color_key })));
});

test("visuals and labels never come out blank or unsafe", () => {
  const cats = [...SEED_EVENT_CATEGORIES, { ...SEED_EVENT_CATEGORIES[0], slug: "bad", icon_key: "<script>", color_key: "javascript:alert(1)" }];
  assert.deepEqual(categoryVisual(cats, "workshop"), { icon: "wrench", color: "brand" });
  assert.deepEqual(categoryVisual(cats, "bad"), { icon: "stethoscope", color: "brand-soft" }); // -> other's look
  assert.deepEqual(categoryVisual([], "anything"), { icon: "stethoscope", color: "brand-soft" });
  assert.equal(categoryLabel(cats, "poster"), "Poster Presentation");
  assert.equal(categoryLabel([], "paper"), "Paper Presentation");
  assert.equal(categoryLabel([], "tamil-literary"), "Tamil literary");
});

test("new-category validation", () => {
  const ok = { slug: "quiz-night", label: "Quiz Night", icon_key: "puzzle", color_key: "violet" };
  assert.ok(newCategorySchema.safeParse(ok).success);
  for (const bad of [{ slug: "Quiz" }, { slug: "all" }, { slug: "a--b" }, { slug: "a".repeat(41) }, { label: "" },
    { label: " x" }, { icon_key: "skull" }, { color_key: "red" }])
    assert.equal(newCategorySchema.safeParse({ ...ok, ...bad }).success, false, JSON.stringify(bad));
});

test("homepage category-link detection", () => {
  const landing = { categories: { boxes: [{ href: "/events?category=linked" }, { href: "/events?x=1&category=quiz#a" }] } };
  assert.equal(linksToCategory(landing, "linked"), true);
  assert.equal(linksToCategory(landing, "quiz"), true);
  assert.equal(linksToCategory(landing, "link"), false);
  assert.equal(linksToCategory(landing, "workshop"), false);
});

test("sanitizeCategories drops malformed rows and sorts by position", () => {
  const rows = sanitizeCategories([{ id: "b", slug: "b", label: "B", position: 2 }, null, { slug: "x" }, { id: "a", slug: "a", label: "A", position: 1, archived_at: "t" }]);
  assert.deepEqual(rows.map((r) => [r.slug, r.archived_at]), [["a", "t"], ["b", null]]);
});
