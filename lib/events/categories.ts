/**
 * Dynamic event categories (0027). Plain module (zod + relative `.ts`
 * imports) so it runs in the browser, on the server and under `node --test`.
 *
 * The icon and tint allowlists MIRROR the CHECK constraints in
 * supabase/migrations/0027_event_categories.sql (a unit test compares them).
 * Visuals are looked up from these keys only — never arbitrary CSS or HTML.
 */
import { z } from "zod";

export const MAX_EVENT_CATEGORIES = 50;
export const MAX_CATEGORY_LABEL = 40;
export const MAX_CATEGORY_SLUG = 40;
export const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Protected fallback category (events.category default). */
export const FALLBACK_CATEGORY = "other";

export const CATEGORY_ICON_KEYS = [
  "wrench", "messages-square", "presentation", "file-text", "trophy", "graduation-cap", "stethoscope",
  "book-open", "mic", "brain", "heart-pulse", "microscope", "flask-conical", "pen-tool", "users",
  "lightbulb", "globe", "music", "camera", "puzzle", "award", "languages", "palette",
] as const;
export type CategoryIconKey = (typeof CATEGORY_ICON_KEYS)[number];

export const CATEGORY_COLOR_KEYS = [
  "brand", "brand-alt", "emerald", "cyan", "teal", "sky", "brand-soft",
  "violet", "amber", "rose", "indigo", "lime", "orange",
] as const;
export type CategoryColorKey = (typeof CATEGORY_COLOR_KEYS)[number];

export const CATEGORY_ICON_LABELS: Record<CategoryIconKey, string> = {
  wrench: "Wrench", "messages-square": "Speech bubbles", presentation: "Presentation board", "file-text": "Document",
  trophy: "Trophy", "graduation-cap": "Graduation cap", stethoscope: "Stethoscope", "book-open": "Open book",
  mic: "Microphone", brain: "Brain", "heart-pulse": "Heart pulse", microscope: "Microscope",
  "flask-conical": "Flask", "pen-tool": "Pen", users: "People", lightbulb: "Light bulb", globe: "Globe",
  music: "Music", camera: "Camera", puzzle: "Puzzle piece", award: "Award", languages: "Languages", palette: "Palette",
};

/** Tint: placeholder gradient class (literal, so Tailwind sees it) + 3D background colour. */
export const CATEGORY_COLORS: Record<CategoryColorKey, { label: string; hue: string; hex: string }> = {
  brand: { label: "Brand teal", hue: "from-brand/25", hex: "#32d6c1" },
  "brand-alt": { label: "Light teal", hue: "from-brand-2/25", hex: "#6cefe2" },
  emerald: { label: "Emerald", hue: "from-emerald-400/20", hex: "#34d399" },
  cyan: { label: "Cyan", hue: "from-cyan-400/20", hex: "#22d3ee" },
  teal: { label: "Teal", hue: "from-teal-300/25", hex: "#2dd4bf" },
  sky: { label: "Sky", hue: "from-sky-400/20", hex: "#38bdf8" },
  "brand-soft": { label: "Soft teal", hue: "from-brand/20", hex: "#32d6c1" },
  violet: { label: "Violet", hue: "from-violet-400/20", hex: "#a78bfa" },
  amber: { label: "Amber", hue: "from-amber-400/20", hex: "#fbbf24" },
  rose: { label: "Rose", hue: "from-rose-400/20", hex: "#fb7185" },
  indigo: { label: "Indigo", hue: "from-indigo-400/20", hex: "#818cf8" },
  lime: { label: "Lime", hue: "from-lime-400/20", hex: "#a3e635" },
  orange: { label: "Orange", hue: "from-orange-400/20", hex: "#fb923c" },
};

export interface EventCategoryInfo {
  id: string;
  slug: string;
  label: string;
  position: number;
  icon_key: string;
  color_key: string;
  archived_at: string | null;
}

/** The original seven (0027 seed) — used only if categories can't be read. */
export const SEED_EVENT_CATEGORIES: EventCategoryInfo[] = [
  ["workshop", "Workshop", "wrench", "brand"],
  ["debate", "Debate", "messages-square", "brand-alt"],
  ["poster", "Poster Presentation", "presentation", "emerald"],
  ["paper", "Paper Presentation", "file-text", "cyan"],
  ["competition", "Competition", "trophy", "teal"],
  ["academic", "Academic Event", "graduation-cap", "sky"],
  ["other", "Other", "stethoscope", "brand-soft"],
].map(([slug, label, icon_key, color_key], i) => ({
  id: `seed-${slug}`,
  slug,
  label,
  position: i + 1,
  icon_key,
  color_key,
  archived_at: null,
}));

export function isIconKey(v: unknown): v is CategoryIconKey {
  return typeof v === "string" && (CATEGORY_ICON_KEYS as readonly string[]).includes(v);
}
export function isColorKey(v: unknown): v is CategoryColorKey {
  return typeof v === "string" && (CATEGORY_COLOR_KEYS as readonly string[]).includes(v);
}

/** Safe visual keys for a category slug: unknown/missing -> `other`'s look. */
export function categoryVisual(
  categories: readonly EventCategoryInfo[],
  slug: string | null | undefined,
): { icon: CategoryIconKey; color: CategoryColorKey } {
  const c = categories.find((x) => x.slug === slug);
  const fallback = categories.find((x) => x.slug === FALLBACK_CATEGORY);
  const pick = <K extends string>(ok: (v: unknown) => v is K, a: unknown, b: unknown, d: K): K =>
    ok(a) ? a : ok(b) ? b : d;
  return {
    icon: pick(isIconKey, c?.icon_key, fallback?.icon_key, "stethoscope"),
    color: pick(isColorKey, c?.color_key, fallback?.color_key, "brand-soft"),
  };
}

/** Display label for a slug; never blank. */
export function categoryLabel(categories: readonly EventCategoryInfo[], slug: string | null | undefined): string {
  const c = categories.find((x) => x.slug === slug);
  if (c) return c.label;
  const seed = SEED_EVENT_CATEGORIES.find((x) => x.slug === slug);
  return seed?.label ?? (slug ? slug.replace(/-/g, " ").replace(/^./, (m) => m.toUpperCase()) : "Event");
}

export function activeCategories(categories: readonly EventCategoryInfo[]): EventCategoryInfo[] {
  return [...categories].filter((c) => !c.archived_at).sort((a, b) => a.position - b.position);
}

/** Normalises rows read from the database (drops anything malformed). */
export function sanitizeCategories(rows: unknown): EventCategoryInfo[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (r): r is EventCategoryInfo =>
        !!r &&
        typeof r === "object" &&
        typeof (r as EventCategoryInfo).id === "string" &&
        typeof (r as EventCategoryInfo).slug === "string" &&
        typeof (r as EventCategoryInfo).label === "string" &&
        typeof (r as EventCategoryInfo).position === "number",
    )
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      label: r.label,
      position: r.position,
      icon_key: String(r.icon_key ?? ""),
      color_key: String(r.color_key ?? ""),
      archived_at: r.archived_at ?? null,
    }))
    .sort((a, b) => a.position - b.position);
}

const labelSchema = z
  .string()
  .refine((v) => v.trim() === v, "Remove leading/trailing spaces")
  .refine((v) => v.length >= 1 && v.length <= MAX_CATEGORY_LABEL, `Use 1–${MAX_CATEGORY_LABEL} characters`);

export const categoryStyleSchema = z.object({
  label: labelSchema,
  icon_key: z.enum(CATEGORY_ICON_KEYS, { message: "Choose an icon from the list" }),
  color_key: z.enum(CATEGORY_COLOR_KEYS, { message: "Choose a tint from the list" }),
});

export const newCategorySchema = categoryStyleSchema.extend({
  slug: z
    .string()
    .max(MAX_CATEGORY_SLUG, `Slug can be at most ${MAX_CATEGORY_SLUG} characters`)
    .regex(CATEGORY_SLUG_PATTERN, "Slug may use lowercase letters, digits and single hyphens")
    .refine((v) => v !== "all", "“all” is reserved"),
});

/** `?category=<slug>` links in a piece of site content (homepage boxes, etc.). */
export function linksToCategory(content: unknown, slug: string): boolean {
  const re = new RegExp(`[?&]category=${slug.replace(/[^a-z0-9-]/g, "")}(?:[^a-z0-9-]|$)`);
  const walk = (v: unknown): boolean =>
    typeof v === "string" ? re.test(v) : Array.isArray(v) ? v.some(walk) : !!v && typeof v === "object" && Object.values(v).some(walk);
  return walk(content);
}
