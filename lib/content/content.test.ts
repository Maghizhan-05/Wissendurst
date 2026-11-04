/**
 * Validation and merge-over-default regression tests for CMS content.
 * Run: npm run test:unit   (node --test, native TypeScript type-stripping)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isSafeHref } from "./validation.ts";
import { DEFAULT_LANDING, landingSchema, mergeLanding, MAX_HOME_BOXES } from "./landing.ts";
import { DEFAULT_ABOUT, aboutSchema, mergeAbout, paragraphs } from "./about.ts";
import {
  COLOR_TOKENS,
  DEFAULT_COLORS,
  appearanceCss,
  appearanceSchema,
  contrastRatio,
  mergeAppearance,
} from "./appearance.ts";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

test("safe links: internal paths and https only", () => {
  for (const ok of ["/", "/events", "/events?category=debate", "/about#team", "https://example.org/x?y=1"])
    assert.equal(isSafeHref(ok), true, ok);
  for (const bad of [
    "", "javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<b>x</b>", "//evil.com",
    "/\\evil.com", "http://example.org", "https://user:pw@example.org", " /events", "/ev ents",
    "mailto:a@b.co", "https://localhost", "/events\n", "vbscript:x", "https://", 42, null,
  ])
    assert.equal(isSafeHref(bad), false, String(bad));
});

test("landing: defaults validate against the save schema", () => {
  assert.equal(landingSchema.safeParse(DEFAULT_LANDING).success, true);
});

test("landing: 0–6 boxes accepted, more than six rejected", () => {
  for (let n = 0; n <= MAX_HOME_BOXES; n++) {
    const c = clone(DEFAULT_LANDING);
    c.categories.boxes = c.categories.boxes.slice(0, n);
    assert.equal(landingSchema.safeParse(c).success, true, `n=${n}`);
  }
  const c = clone(DEFAULT_LANDING);
  c.categories.boxes.push({ ...c.categories.boxes[0], id: "box-seventh" });
  assert.equal(landingSchema.safeParse(c).success, false);
});

test("landing: unsafe link, unknown icon, duplicate id and blank title are rejected", () => {
  const mutate = (f: (c: typeof DEFAULT_LANDING) => void) => {
    const c = clone(DEFAULT_LANDING);
    f(c);
    return landingSchema.safeParse(c).success;
  };
  assert.equal(mutate((c) => (c.categories.boxes[0].href = "javascript:alert(1)")), false);
  assert.equal(mutate((c) => (c.categories.boxes[0].href = "//evil.com")), false);
  assert.equal(mutate((c) => ((c.categories.boxes[0] as { icon: string }).icon = "skull")), false);
  assert.equal(mutate((c) => (c.categories.boxes[1].id = c.categories.boxes[0].id)), false);
  assert.equal(mutate((c) => (c.categories.boxes[0].title = "  ")), false);
  assert.equal(mutate((c) => (c.hero.ctaPrimaryHref = "http://insecure.example.org")), false);
  assert.equal(mutate((c) => (c.categories.boxes[0].href = "https://example.org/tracks")), true);
});

test("landing: null / garbage stored content falls back to defaults", () => {
  assert.deepEqual(mergeLanding(null), DEFAULT_LANDING);
  assert.deepEqual(mergeLanding("nope"), DEFAULT_LANDING);
  assert.deepEqual(mergeLanding([1, 2]), DEFAULT_LANDING);
});

test("landing: pre-Phase-4 saved JSON keeps its text and gains new defaults", () => {
  // Shape of the live row before Phase 4 (no visibility, hrefs or boxes).
  const legacy = {
    hero: { ...clone(DEFAULT_LANDING.hero), date: "January 28 - 31 , 2027", venue: "ESIC" } as Record<string, unknown>,
    intro: { index: "01", eyebrow: "Introduction", title: "T", paragraphs: ["Custom paragraph"] },
    categories: { index: "02", eyebrow: "Event Categories", title: "Six ways", description: "D" },
    featured: { index: "03", eyebrow: "Featured Events", title: "Where to start." },
    why: { index: "04", eyebrow: "Why", title: "W", points: [{ title: "Learn", body: "B" }] },
    journey: { index: "05", eyebrow: "J", title: "J", steps: [] },
    info: { index: "06", eyebrow: "I", title: "I", items: [{ label: "Contact", value: "x@y.co" }] },
    finalCta: { title: "Ready?", description: "D", ctaPrimary: "Go", ctaSecondary: "See" },
    footer: { tagline: "Tag", contactEmail: "x@y.co", dates: "Jan" },
  };
  delete legacy.hero.ctaPrimaryHref;
  delete legacy.hero.ctaSecondaryHref;
  const m = mergeLanding(legacy);
  assert.equal(m.hero.date, "January 28 - 31 , 2027");
  assert.equal(m.hero.venue, "ESIC");
  assert.equal(m.hero.ctaPrimaryHref, "/signup");
  assert.deepEqual(m.intro.paragraphs, ["Custom paragraph"]);
  assert.equal(m.intro.visible, true);
  assert.equal(m.categories.title, "Six ways");
  assert.deepEqual(m.categories.boxes, DEFAULT_LANDING.categories.boxes);
  assert.equal(m.featured.ctaLabel, "All events");
  assert.deepEqual(m.why.points, [{ title: "Learn", body: "B" }]);
  assert.deepEqual(m.journey.steps, DEFAULT_LANDING.journey.steps, "legacy empty list → defaults");
  assert.equal(m.finalCta.ctaSecondaryHref, "/events");
  assert.equal(m.footer.tagline, "Tag");
  assert.equal(m.footer.contactName, "Organizing Committee");
  assert.equal(landingSchema.safeParse(m).success, true, "merged result is saveable");
});

test("landing: stored boxes — empty honoured, invalid dropped, capped at six", () => {
  const base = clone(DEFAULT_LANDING);
  assert.deepEqual(mergeLanding({ ...base, categories: { ...base.categories, boxes: [] } }).categories.boxes, []);

  const boxes = clone(base.categories.boxes);
  boxes[1].href = "javascript:alert(1)";
  (boxes[2] as { icon: string }).icon = "skull";
  const kept = mergeLanding({ ...base, categories: { ...base.categories, boxes } }).categories.boxes;
  assert.deepEqual(kept.map((b) => b.id), ["box-workshop", "box-paper", "box-competition", "box-academic"]);

  const many = [...base.categories.boxes, { ...base.categories.boxes[0], id: "box-7" }, { ...base.categories.boxes[0], id: "box-8" }];
  assert.equal(mergeLanding({ ...base, categories: { ...base.categories, boxes: many } }).categories.boxes.length, 6);

  const dup = [base.categories.boxes[0], base.categories.boxes[0]];
  assert.equal(mergeLanding({ ...base, categories: { ...base.categories, boxes: dup } }).categories.boxes.length, 1);
});

test("landing: invalid individual fields fall back without losing valid siblings", () => {
  const m = mergeLanding({
    hero: { titleLine1: 123, eyebrow: "Kept", ctaPrimaryHref: "javascript:x" },
    featured: { visible: "yes", title: "Kept title" },
  });
  assert.equal(m.hero.titleLine1, DEFAULT_LANDING.hero.titleLine1);
  assert.equal(m.hero.eyebrow, "Kept");
  assert.equal(m.hero.ctaPrimaryHref, "/signup");
  assert.equal(m.featured.visible, true);
  assert.equal(m.featured.title, "Kept title");
});

test("about: defaults valid, merge keeps order/visibility and rejects unsafe links", () => {
  assert.equal(aboutSchema.safeParse(DEFAULT_ABOUT).success, true);
  assert.deepEqual(mergeAbout(null), DEFAULT_ABOUT);
  const reordered = [...DEFAULT_ABOUT.sections].reverse().map((s, i) => ({ ...s, visible: i === 0 }));
  const m = mergeAbout({ title: "New", sections: reordered, cta: { ...DEFAULT_ABOUT.cta, primaryHref: "javascript:x" }, facts: { visible: false, items: [] } });
  assert.equal(m.title, "New");
  assert.equal(m.intro, DEFAULT_ABOUT.intro);
  assert.deepEqual(m.sections.map((s) => s.id), ["section-eligibility", "section-values"]);
  assert.deepEqual(m.sections.map((s) => s.visible), [true, false]);
  assert.equal(m.cta.primaryHref, "/events");
  assert.equal(m.facts.visible, false);
  assert.deepEqual(m.facts.items, []);
});

test("about: save schema limits and validation", () => {
  const c = clone(DEFAULT_ABOUT);
  c.facts.items = Array.from({ length: 7 }, (_, i) => ({ id: `fact-${i}`, value: "1", label: "x" }));
  assert.equal(aboutSchema.safeParse(c).success, false, "more than 6 facts");
  const d = clone(DEFAULT_ABOUT);
  d.sections[1].id = d.sections[0].id;
  assert.equal(aboutSchema.safeParse(d).success, false, "duplicate section id");
  const e = clone(DEFAULT_ABOUT);
  e.cta.secondaryHref = "//evil.com";
  assert.equal(aboutSchema.safeParse(e).success, false, "unsafe CTA link");
  assert.deepEqual(paragraphs("One\n\n  Two  \n\n\nThree"), ["One", "Two", "Three"]);
});

test("appearance: only allowlisted tokens with #rrggbb values", () => {
  assert.equal(appearanceSchema.safeParse({ light: { brand: "#123ABC" }, dark: {} }).success, true);
  for (const bad of [
    { light: { brand: "red" }, dark: {} },
    { light: { brand: "#fff" }, dark: {} },
    { light: { brand: "#000000;}body{display:none" }, dark: {} },
    { light: { brand: "url(javascript:x)" }, dark: {} },
    { light: { "font-family": "#000000" }, dark: {} },
    { light: {}, dark: {}, extra: {} },
    { light: {} },
  ])
    assert.equal(appearanceSchema.safeParse(bad).success, false, JSON.stringify(bad));
});

test("appearance: merge drops invalid values; CSS contains only valid overrides", () => {
  const stored = {
    light: { brand: "#ABCDEF", surface: "blue", ring: "#000000;}*{x:y" },
    dark: { background: "#010203", unknown: "#ffffff" },
    evil: { brand: "#ffffff" },
  };
  assert.deepEqual(mergeAppearance(stored), { light: { brand: "#abcdef" }, dark: { background: "#010203" } });
  assert.equal(appearanceCss(stored), "html:root{--brand:#abcdef;}html.dark{--background:#010203;}");
  assert.equal(appearanceCss(null), "");
  assert.equal(appearanceCss({ light: {}, dark: {} }), "");
});

test("appearance: design defaults mirror app/globals.css", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf("}", start));
  };
  for (const [mode, selector] of [["light", ":root"], ["dark", ".dark"]] as const) {
    const body = block(selector);
    for (const token of COLOR_TOKENS) {
      const m = body.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6});`));
      assert.ok(m, `${selector} --${token}`);
      assert.equal(DEFAULT_COLORS[mode][token], m![1].toLowerCase(), `${mode} ${token}`);
    }
  }
});

test("appearance: contrast ratio", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
  assert.equal(contrastRatio("#777777", "#777777"), 1);
  assert.ok(contrastRatio(DEFAULT_COLORS.light.foreground, DEFAULT_COLORS.light.background) >= 4.5);
  assert.ok(contrastRatio(DEFAULT_COLORS.dark.foreground, DEFAULT_COLORS.dark.background) >= 4.5);
});
