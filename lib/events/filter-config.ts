/**
 * Event filter bar configuration (0025): an admin-managed grouping layer over
 * the seven canonical event categories. Plain module (zod + relative `.ts`
 * imports) so it runs in the browser, on the server and under `node --test`.
 *
 * The database re-validates the same rules (event_filter_config_error).
 */
import { z } from "zod";
import { EVENT_CATEGORIES, EVENT_CATEGORY_LABELS, type EventCategory } from "../constants.ts";

export const MAX_FILTER_GROUPS = 7;
export const MAX_FILTER_LABEL = 40;
export const MAX_FILTER_SLUG = 40;

export const FILTER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const FILTER_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Slugs that would collide with the All tab. */
export const RESERVED_SLUGS = ["all"] as const;

export interface FilterGroup {
  id: string;
  slug: string;
  label: string;
  enabled: boolean;
  position: number; // 1-based, equals array order
  categories: EventCategory[];
}

export interface EventFilterConfig {
  allLabel: string;
  groups: FilterGroup[];
}

const label = z
  .string()
  .refine((v) => v.trim() === v, "Remove leading/trailing spaces")
  .refine((v) => v.length >= 1 && v.length <= MAX_FILTER_LABEL, `Use 1–${MAX_FILTER_LABEL} characters`);

const groupSchema = z
  .object({
    id: z.string().regex(FILTER_ID_PATTERN, "Invalid group id"),
    slug: z
      .string()
      .max(MAX_FILTER_SLUG, `Slug can be at most ${MAX_FILTER_SLUG} characters`)
      .regex(FILTER_SLUG_PATTERN, "Slug may use lowercase letters, digits and single hyphens")
      .refine((v) => !(RESERVED_SLUGS as readonly string[]).includes(v), "“all” is reserved"),
    label,
    enabled: z.boolean(),
    position: z.number().int().min(1),
    categories: z
      .array(z.enum(EVENT_CATEGORIES))
      .min(1, "Choose at least one category")
      .max(EVENT_CATEGORIES.length)
      .refine((c) => new Set(c).size === c.length, "Duplicate category"),
  })
  .strict();

export const eventFilterConfigSchema = z
  .object({
    allLabel: label,
    groups: z.array(groupSchema).max(MAX_FILTER_GROUPS, `At most ${MAX_FILTER_GROUPS} groups`),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const ids = new Set<string>();
    const slugs = new Set<string>();
    cfg.groups.forEach((g, i) => {
      if (g.position !== i + 1)
        ctx.addIssue({ code: "custom", path: ["groups", i, "position"], message: "Positions must follow the list order" });
      if (ids.has(g.id)) ctx.addIssue({ code: "custom", path: ["groups", i, "id"], message: "Duplicate group id" });
      if (slugs.has(g.slug))
        ctx.addIssue({ code: "custom", path: ["groups", i, "slug"], message: `Slug “${g.slug}” is used twice` });
      ids.add(g.id);
      slugs.add(g.slug);
    });
  });

/** The pre-0025 bar exactly: All + one tab per canonical category, in order. */
export const DEFAULT_EVENT_FILTER_CONFIG: EventFilterConfig = {
  allLabel: "All",
  groups: EVENT_CATEGORIES.map((c, i) => ({
    id: c,
    slug: c,
    label: EVENT_CATEGORY_LABELS[c],
    enabled: true,
    position: i + 1,
    categories: [c],
  })),
};

export type FilterValidation =
  | { ok: true; config: EventFilterConfig }
  | { ok: false; error: string };

export function validateEventFilterConfig(raw: unknown): FilterValidation {
  const r = eventFilterConfigSchema.safeParse(raw);
  if (r.success) return { ok: true, config: r.data as EventFilterConfig };
  const issue = r.error.issues[0];
  const where = issue.path.length ? ` (${issue.path.join(".")})` : "";
  return { ok: false, error: `${issue.message}${where}` };
}

/** Public read: stored config if valid, otherwise the default (never throws). */
export function resolveEventFilterConfig(raw: unknown): EventFilterConfig {
  const v = validateEventFilterConfig(raw);
  return v.ok ? v.config : DEFAULT_EVENT_FILTER_CONFIG;
}

/** Enabled groups in display order. */
export function visibleGroups(cfg: EventFilterConfig): FilterGroup[] {
  return cfg.groups.filter((g) => g.enabled);
}

/** Canonical categories no enabled group covers (still reachable via All). */
export function unassignedCategories(cfg: EventFilterConfig): EventCategory[] {
  const covered = new Set(visibleGroups(cfg).flatMap((g) => g.categories));
  return EVENT_CATEGORIES.filter((c) => !covered.has(c));
}

export type ActiveFilter =
  | { kind: "all" }
  | { kind: "group"; group: FilterGroup }
  | { kind: "category"; category: EventCategory }; // legacy deep link with no matching group

/**
 * Resolves `?category=` from a URL: an enabled group slug first; then a
 * canonical category (legacy `?category=workshop` links keep working even if
 * the groups were renamed); otherwise All.
 */
export function resolveActiveFilter(cfg: EventFilterConfig, param: string | null | undefined): ActiveFilter {
  const p = (param ?? "").trim().toLowerCase();
  if (!p || p === "all") return { kind: "all" };
  const groups = visibleGroups(cfg);
  const bySlug = groups.find((g) => g.slug === p);
  if (bySlug) return { kind: "group", group: bySlug };
  if ((EVENT_CATEGORIES as readonly string[]).includes(p)) {
    const cat = p as EventCategory;
    const exact = groups.find((g) => g.categories.length === 1 && g.categories[0] === cat);
    return exact ? { kind: "group", group: exact } : { kind: "category", category: cat };
  }
  return { kind: "all" };
}

/** Whether an event of `category` is shown under `filter` (groups are unions). */
export function matchesFilter(filter: ActiveFilter, category: EventCategory): boolean {
  if (filter.kind === "all") return true;
  if (filter.kind === "category") return filter.category === category;
  return filter.group.categories.includes(category);
}

/** Lowercase-hyphen slug from a label (admin convenience). */
export function slugifyLabel(v: string): string {
  return v
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_FILTER_SLUG)
    .replace(/-+$/g, "");
}
