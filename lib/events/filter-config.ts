/**
 * Event filter bar configuration (0025, category references by UUID since
 * 0027): an admin-managed grouping layer over the event categories. Plain
 * module (zod + relative `.ts` imports) so it runs in the browser, on the
 * server and under `node --test`.
 *
 * The database re-validates the same rules (event_filter_config_error).
 */
import { z } from "zod";
import { MAX_EVENT_CATEGORIES, activeCategories, type EventCategoryInfo } from "./categories.ts";

export const MAX_FILTER_GROUPS = 7;
export const MAX_FILTER_LABEL = 40;
export const MAX_FILTER_SLUG = 40;

export const FILTER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const FILTER_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CATEGORY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Slugs that would collide with the All tab. */
export const RESERVED_SLUGS = ["all"] as const;

export interface FilterGroup {
  id: string;
  slug: string;
  label: string;
  enabled: boolean;
  position: number; // 1-based, equals array order
  /** event_categories.id values */
  categories: string[];
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
      .array(z.string().regex(CATEGORY_ID_PATTERN, "Unknown category"))
      .min(1, "Choose at least one category")
      .max(MAX_EVENT_CATEGORIES)
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

/**
 * Default bar: All + one tab per active category (in category order, at most
 * seven), tab slug = category slug. With the original seven categories this is
 * exactly the pre-0025 bar.
 */
export function defaultEventFilterConfig(categories: readonly EventCategoryInfo[]): EventFilterConfig {
  return {
    allLabel: "All",
    groups: activeCategories(categories)
      .slice(0, MAX_FILTER_GROUPS)
      .map((c, i) => ({
        id: c.slug,
        slug: c.slug,
        label: c.label,
        enabled: true,
        position: i + 1,
        categories: [c.id],
      })),
  };
}

export type FilterValidation =
  | { ok: true; config: EventFilterConfig }
  | { ok: false; error: string };

export interface FilterValidationContext {
  /** Known categories (archived included). When given, unknown ids are rejected. */
  categories?: readonly EventCategoryInfo[];
  /**
   * The stored configuration being replaced. When given (null = none), an
   * archived category is accepted only in a group (same id) that already had it.
   */
  previous?: EventFilterConfig | null;
}

export function validateEventFilterConfig(raw: unknown, ctx: FilterValidationContext = {}): FilterValidation {
  const r = eventFilterConfigSchema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue.path.length ? ` (${issue.path.join(".")})` : "";
    return { ok: false, error: `${issue.message}${where}` };
  }
  const config = r.data as EventFilterConfig;
  if (ctx.categories) {
    const byId = new Map(ctx.categories.map((c) => [c.id, c]));
    for (const g of config.groups) {
      // Saving: a tab may not newly take a category's slug (tabs resolve first,
      // so its ?category= link would be hidden) unless it shows exactly that
      // category; a tab that already had the slug keeps it.
      if (ctx.previous !== undefined) {
        const shadowed = shadowedCategory(g, ctx.categories);
        const before = ctx.previous?.groups.find((p) => p.id === g.id);
        if (shadowed && before?.slug !== g.slug)
          return {
            ok: false,
            error: `Slug “${g.slug}” belongs to the category “${shadowed.label}”; pick another slug for “${g.label}”`,
          };
      }
      for (const id of g.categories) {
        const c = byId.get(id);
        if (!c) return { ok: false, error: `“${g.label}” refers to a category that no longer exists` };
        if (c.archived_at && ctx.previous !== undefined) {
          const before = ctx.previous?.groups.find((p) => p.id === g.id);
          if (!before?.categories.includes(id))
            return { ok: false, error: `“${c.label}” is archived and can't be added to “${g.label}”` };
        }
      }
    }
  }
  return { ok: true, config };
}

/** The category whose `?category=` link this tab's slug would hide, if any. */
export function shadowedCategory(
  group: FilterGroup,
  categories: readonly EventCategoryInfo[],
): EventCategoryInfo | null {
  const c = categories.find((x) => x.slug === group.slug);
  if (!c) return null;
  return group.categories.length === 1 && group.categories[0] === c.id ? null : c;
}

/** Public read: stored config if valid, otherwise the default (never throws). */
export function resolveEventFilterConfig(raw: unknown, categories: readonly EventCategoryInfo[]): EventFilterConfig {
  const v = validateEventFilterConfig(raw, { categories });
  return v.ok ? v.config : defaultEventFilterConfig(categories);
}

/** Enabled groups in display order. */
export function visibleGroups(cfg: EventFilterConfig): FilterGroup[] {
  return cfg.groups.filter((g) => g.enabled);
}

/** Active categories no enabled group covers (still reachable via All). */
export function unassignedCategories(
  cfg: EventFilterConfig,
  categories: readonly EventCategoryInfo[],
): EventCategoryInfo[] {
  const covered = new Set(visibleGroups(cfg).flatMap((g) => g.categories));
  return activeCategories(categories).filter((c) => !covered.has(c.id));
}

export type ActiveFilter =
  | { kind: "all" }
  | { kind: "group"; group: FilterGroup }
  | { kind: "category"; category: EventCategoryInfo }; // legacy deep link with no matching group

/**
 * Resolves `?category=` from a URL: an enabled group slug first; then a
 * category slug (archived ones too — old `?category=workshop` links keep
 * working even if the groups were renamed); otherwise All.
 */
export function resolveActiveFilter(
  cfg: EventFilterConfig,
  categories: readonly EventCategoryInfo[],
  param: string | null | undefined,
): ActiveFilter {
  const p = (param ?? "").trim().toLowerCase();
  if (!p || p === "all") return { kind: "all" };
  const groups = visibleGroups(cfg);
  const bySlug = groups.find((g) => g.slug === p);
  if (bySlug) return { kind: "group", group: bySlug };
  const cat = categories.find((c) => c.slug === p);
  if (cat) {
    const exact = groups.find((g) => g.categories.length === 1 && g.categories[0] === cat.id);
    return exact ? { kind: "group", group: exact } : { kind: "category", category: cat };
  }
  return { kind: "all" };
}

/** Whether an event whose category has id `categoryId` is shown under `filter` (groups are unions). */
export function matchesFilter(filter: ActiveFilter, categoryId: string | undefined): boolean {
  if (filter.kind === "all") return true;
  if (!categoryId) return false;
  if (filter.kind === "category") return filter.category.id === categoryId;
  return filter.group.categories.includes(categoryId);
}

/** Lowercase-hyphen slug from a label (admin convenience). */
export function slugifyLabel(v: string, max = MAX_FILTER_SLUG): string {
  return v
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}
