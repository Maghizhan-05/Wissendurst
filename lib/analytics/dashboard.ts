/**
 * Super-admin analytics dashboard data (D-025, D-026). Pure apart from the
 * injected `fetch`; the server-only wrapper lives in lib/data/analytics-dashboard.ts.
 *
 * Reads AGGREGATES from PostHog Cloud EU's private Query API with a
 * server-only personal API key (scopes: query:read, heatmap:read) and the
 * numeric project ID. Typed TrendsQuery / FunnelsQuery requests are used
 * where their response contract is validated by a strict parser; HogQL
 * aggregates are the proven fallback (and the source for unique sessions).
 * Nothing selects person/distinct IDs, sessions as rows, replays or raw
 * exception payloads. Every section is isolated: one failing query only
 * blanks its own panel. Missing/rejected configuration fails closed.
 */
import { isAnalyticsRoute, normalizePathname } from "./routes.ts";
import { redactText } from "./redact.ts";

/** PostHog Cloud EU app/API host (private API; not the ingestion host). */
export const POSTHOG_EU_APP_HOST = "https://eu.posthog.com";

// ── range ────────────────────────────────────────────────────────────────────
export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];
export const DEFAULT_RANGE: RangeDays = 30;

/** `?range=` → 7 | 30 | 90 (anything else → 30). */
export function parseRange(input: unknown): RangeDays {
  const v = Array.isArray(input) ? input[0] : input;
  if (typeof v !== "string" || !/^(7|30|90)$/.test(v)) return DEFAULT_RANGE;
  return Number(v) as RangeDays;
}

// ── config ───────────────────────────────────────────────────────────────────
export interface DashboardConfig {
  apiKey: string;
  projectId: string;
}
export type ConfigResult = { ok: true; config: DashboardConfig } | { ok: false; reason: "missing" | "invalid" };
export type DashboardEnv = { POSTHOG_PERSONAL_API_KEY?: string; POSTHOG_PROJECT_ID?: string };

/** Personal API keys start with `phx_`; project IDs are numeric. */
export function parseDashboardConfig(env: DashboardEnv): ConfigResult {
  const apiKey = (env.POSTHOG_PERSONAL_API_KEY ?? "").trim();
  const projectId = (env.POSTHOG_PROJECT_ID ?? "").trim();
  if (!apiKey || !projectId) return { ok: false, reason: "missing" };
  if (!/^phx_[A-Za-z0-9]{20,100}$/.test(apiKey) || !/^\d{1,12}$/.test(projectId)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, config: { apiKey, projectId } };
}

// ── transport ────────────────────────────────────────────────────────────────
export type FetchInit = RequestInit & { next?: { revalidate?: number } };
export type FetchLike = (url: string, init: FetchInit) => Promise<Response>;

/** Short server-side Data Cache window for aggregate reads (no client polling). */
export const QUERY_REVALIDATE_SECONDS = 60;
export const REQUEST_TIMEOUT_MS = 10_000;
const MAX_CONCURRENCY = 4;

export type Failure = "rejected" | "missing-scope" | "failed";

export class ProviderError extends Error {
  readonly kind: Failure;
  readonly scope?: string;
  constructor(kind: Failure, scope?: string) {
    super(kind);
    this.kind = kind;
    this.scope = scope;
  }
}

/** Maps a non-2xx PostHog response to a failure class (never surfaces the body). */
export async function classifyFailure(res: Response): Promise<ProviderError> {
  if (res.status === 401) return new ProviderError("rejected");
  if (res.status === 403) {
    let detail = "";
    try {
      const body = (await res.json()) as { detail?: unknown };
      detail = typeof body?.detail === "string" ? body.detail : "";
    } catch {
      // Unknown body: generic rejection.
    }
    const m = /missing required scope '([a-z_]+:(?:read|write))'/.exec(detail);
    return m ? new ProviderError("missing-scope", m[1]) : new ProviderError("rejected");
  }
  return new ProviderError("failed");
}

export function authHeaders(config: DashboardConfig): Record<string, string> {
  return { Authorization: `Bearer ${config.apiKey}` };
}

export function timeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
}

/** POST /api/projects/:id/query/ — returns the parsed JSON body or throws ProviderError. */
export async function postQuery(config: DashboardConfig, query: QueryNode, fetchImpl: FetchLike): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(`${POSTHOG_EU_APP_HOST}/api/projects/${config.projectId}/query/`, {
      method: "POST",
      headers: { ...authHeaders(config), "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: timeoutSignal(),
      next: { revalidate: QUERY_REVALIDATE_SECONDS },
    });
  } catch {
    throw new ProviderError("failed");
  }
  if (!res.ok) throw await classifyFailure(res);
  try {
    return await res.json();
  } catch {
    throw new ProviderError("failed");
  }
}

// ── query builders ───────────────────────────────────────────────────────────
type EventsNode = { kind: "EventsNode"; event: string; name: string; math?: "total" };
export type TrendsQuery = {
  kind: "TrendsQuery";
  series: EventsNode[];
  interval: "day";
  dateRange: { date_from: string; date_to: null };
  filterTestAccounts: false;
  trendsFilter: { display: "ActionsLineGraph" };
};
export type FunnelsQuery = {
  kind: "FunnelsQuery";
  series: EventsNode[];
  dateRange: { date_from: string; date_to: null };
  funnelsFilter: {
    funnelVizType: "steps";
    funnelOrderType: "ordered";
    funnelWindowInterval: 14;
    funnelWindowIntervalUnit: "day";
  };
};
export type HogQLQuery = { kind: "HogQLQuery"; query: string };
export type QueryNode = TrendsQuery | FunnelsQuery | HogQLQuery;

/** PostHog relative date: `-6d` = start of the day 6 days ago → 7 daily buckets. */
export const relativeFrom = (days: RangeDays) => `-${days - 1}d`;

/** Only the enumerated ranges ever reach a query string. */
function windowClause(days: RangeDays): string {
  const back = { 7: 6, 30: 29, 90: 89 }[days];
  return `timestamp >= toStartOfDay(now()) - INTERVAL ${back} DAY`;
}

export function trendsQuery(days: RangeDays): TrendsQuery {
  return {
    kind: "TrendsQuery",
    series: [
      { kind: "EventsNode", event: "$pageview", name: "$pageview", math: "total" },
      { kind: "EventsNode", event: "$exception", name: "$exception", math: "total" },
    ],
    interval: "day",
    dateRange: { date_from: relativeFrom(days), date_to: null },
    filterTestAccounts: false,
    trendsFilter: { display: "ActionsLineGraph" },
  };
}

export function funnelsQuery(days: RangeDays): FunnelsQuery {
  return {
    kind: "FunnelsQuery",
    series: [
      { kind: "EventsNode", event: "registration_started", name: "registration_started" },
      { kind: "EventsNode", event: "free_registration_confirmed", name: "free_registration_confirmed" },
    ],
    dateRange: { date_from: relativeFrom(days), date_to: null },
    funnelsFilter: {
      funnelVizType: "steps",
      funnelOrderType: "ordered",
      funnelWindowInterval: 14,
      funnelWindowIntervalUnit: "day",
    },
  };
}

export type BreakdownDimension = "browser" | "os" | "device";

/** Aggregate-only HogQL (counts, dates, public paths, coarse categories). */
export function hogqlQueries(days: RangeDays) {
  const W = windowClause(days);
  return {
    traffic: `SELECT count() AS pageviews, count(DISTINCT properties.$session_id) AS sessions FROM events WHERE event = '$pageview' AND ${W}`,
    totals: `SELECT countIf(event = 'registration_started') AS started, countIf(event = 'free_registration_confirmed') AS confirmed, countIf(event = '$exception') AS exceptions FROM events WHERE event IN ('registration_started', 'free_registration_confirmed', '$exception') AND ${W}`,
    daily: `SELECT toDate(timestamp) AS day, count() AS pageviews, count(DISTINCT properties.$session_id) AS sessions FROM events WHERE event = '$pageview' AND ${W} GROUP BY day ORDER BY day ASC LIMIT 120`,
    dailyExceptions: `SELECT toDate(timestamp) AS day, count() AS total FROM events WHERE event = '$exception' AND ${W} GROUP BY day ORDER BY day ASC LIMIT 120`,
    topPaths: `SELECT properties.$pathname AS path, count() AS views FROM events WHERE event = '$pageview' AND ${W} GROUP BY path ORDER BY views DESC LIMIT 50`,
    browser: `SELECT properties.$browser AS name, count() AS total FROM events WHERE event = '$pageview' AND ${W} GROUP BY name ORDER BY total DESC LIMIT 50`,
    os: `SELECT properties.$os AS name, count() AS total FROM events WHERE event = '$pageview' AND ${W} GROUP BY name ORDER BY total DESC LIMIT 50`,
    device: `SELECT properties.$device_type AS name, count() AS total FROM events WHERE event = '$pageview' AND ${W} GROUP BY name ORDER BY total DESC LIMIT 50`,
    exceptionTypes: `SELECT JSONExtractString(properties.$exception_list, 1, 'type') AS type, count() AS total FROM events WHERE event = '$exception' AND ${W} GROUP BY type ORDER BY total DESC LIMIT 10`,
  } as const;
}
export type HogQLName = keyof ReturnType<typeof hogqlQueries>;

// ── parsers ──────────────────────────────────────────────────────────────────
type Rows = unknown[][];
const DAY = /^(\d{4}-\d{2}-\d{2})(?:[T ]00:00:00(?:\.0+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0
    ? Math.floor(v)
    : typeof v === "string" && /^\d{1,15}$/.test(v)
      ? Number(v)
      : null;

export function dayKey(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = DAY.exec(v.trim());
  return m ? m[1] : null;
}

/** HogQLQueryResponse → rows (results must be an array of arrays). */
export function hogqlRows(body: unknown): Rows | null {
  const r = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(r) || !r.every(Array.isArray)) return null;
  return r as Rows;
}

export function parseTraffic(rows: Rows): { pageviews: number; sessions: number } | null {
  const r = rows[0];
  if (!Array.isArray(r)) return null;
  const pageviews = count(r[0]);
  const sessions = count(r[1]);
  return pageviews === null || sessions === null ? null : { pageviews, sessions };
}

export function parseTotals(rows: Rows): { started: number; confirmed: number; exceptions: number } | null {
  const r = rows[0];
  if (!Array.isArray(r)) return null;
  const [started, confirmed, exceptions] = [count(r[0]), count(r[1]), count(r[2])];
  return started === null || confirmed === null || exceptions === null ? null : { started, confirmed, exceptions };
}

export type DailyRow = { day: string; pageviews: number; sessions: number };
export function parseDaily(rows: Rows): DailyRow[] | null {
  const out: DailyRow[] = [];
  for (const r of rows) {
    const day = dayKey(r[0]);
    const pageviews = count(r[1]);
    const sessions = count(r[2]);
    if (!day || pageviews === null || sessions === null) return null;
    out.push({ day, pageviews, sessions });
  }
  return out;
}

export function parseDailyCounts(rows: Rows): { day: string; count: number }[] | null {
  const out: { day: string; count: number }[] = [];
  for (const r of rows) {
    const day = dayKey(r[0]);
    const c = count(r[1]);
    if (!day || c === null) return null;
    out.push({ day, count: c });
  }
  return out;
}

export type TrendSeries = { days: string[]; values: number[] };

/**
 * TrendsQueryResponse → one daily series per requested event. Strict: every
 * requested event must be present (matched by `action.id` / `label`), with
 * equal-length `days` (YYYY-MM-DD) and non-negative numeric `data`. Any
 * deviation returns null so the caller uses the HogQL fallback.
 */
export function parseTrends(body: unknown, events: string[]): Record<string, TrendSeries> | null {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results) || results.length !== events.length) return null;
  const out: Record<string, TrendSeries> = {};
  for (const item of results) {
    if (!item || typeof item !== "object") return null;
    const it = item as { action?: { id?: unknown } | null; label?: unknown; days?: unknown; data?: unknown };
    const id = typeof it.action?.id === "string" ? it.action.id : typeof it.label === "string" ? it.label : null;
    if (!id || !events.includes(id) || out[id]) return null;
    if (!Array.isArray(it.days) || !Array.isArray(it.data) || it.days.length !== it.data.length) return null;
    if (it.days.length === 0 || it.days.length > 120) return null;
    const days: string[] = [];
    const values: number[] = [];
    for (let i = 0; i < it.days.length; i++) {
      const d = dayKey(it.days[i]);
      const v = count(it.data[i]);
      if (!d || v === null) return null;
      days.push(d);
      values.push(v);
    }
    out[id] = { days, values };
  }
  const first = out[events[0]].days.join();
  return events.every((e) => out[e].days.join() === first) ? out : null;
}

/**
 * FunnelsQueryResponse (steps viz, no breakdown) → two ordered steps.
 * Accepts `results: Step[]` or a single-group `results: [Step[]]`.
 */
export function parseFunnel(body: unknown, events: string[]): { started: number; confirmed: number } | null {
  let results = (body as { results?: unknown } | null)?.results;
  if (Array.isArray(results) && results.length === 1 && Array.isArray(results[0])) results = results[0];
  if (!Array.isArray(results) || results.length !== events.length) return null;
  const counts: number[] = [];
  for (let i = 0; i < results.length; i++) {
    const s = results[i] as { order?: unknown; count?: unknown; action_id?: unknown; name?: unknown } | null;
    if (!s || typeof s !== "object" || s.order !== i) return null;
    const id = typeof s.action_id === "string" ? s.action_id : typeof s.name === "string" ? s.name : null;
    if (id !== events[i]) return null;
    const c = count(s.count);
    if (c === null) return null;
    counts.push(c);
  }
  if (counts[1] > counts[0]) return null;
  return { started: counts[0], confirmed: counts[1] };
}

/** Public paths only (anything else — odd/legacy values — is excluded). */
export function parseTopPaths(rows: Rows): { path: string; views: number }[] | null {
  const out = new Map<string, number>();
  for (const r of rows) {
    const path = normalizePathname(typeof r[0] === "string" ? r[0] : null);
    const views = count(r[1]);
    if (views === null) return null;
    if (!path || !isAnalyticsRoute(path)) continue;
    out.set(path, (out.get(path) ?? 0) + views);
  }
  return [...out.entries()]
    .map(([path, views]) => ({ path, views }))
    .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path))
    .slice(0, 10);
}

/** Type names only, re-redacted and shortened; never messages or stacks. */
export function parseExceptionTypes(rows: Rows): { type: string; total: number }[] | null {
  const merged = new Map<string, number>();
  for (const r of rows) {
    const total = count(r[1]);
    if (total === null) return null;
    const raw = typeof r[0] === "string" && r[0].trim() ? r[0] : "Unknown";
    const type = (redactText(raw, 60) ?? "Unknown").replace(/[^\w.$:[\]-]+/g, " ").trim() || "Unknown";
    merged.set(type, (merged.get(type) ?? 0) + total);
  }
  return [...merged.entries()].map(([type, total]) => ({ type, total })).sort((a, b) => b.total - a.total);
}

// ── privacy-safe device/browser/OS categories ────────────────────────────────
export const MIN_BUCKET = 5;
export const OTHER = "Other";

const BROWSERS: [RegExp, string][] = [
  [/\bedg(e|a|ios)?\b|microsoft edge/i, "Edge"],
  [/samsung/i, "Samsung Internet"],
  [/\bopera\b|\bopr\b/i, "Opera"],
  [/firefox|fxios/i, "Firefox"],
  [/chrome|chromium|crios/i, "Chrome"],
  [/safari/i, "Safari"],
];
const OSES: [RegExp, string][] = [
  [/windows/i, "Windows"],
  [/android/i, "Android"],
  [/\bios\b|ipados|iphone|ipad/i, "iOS"],
  [/mac\s?os|os x|macos/i, "macOS"],
  [/chrome\s?os|chromeos/i, "ChromeOS"],
  [/linux|ubuntu|fedora|debian/i, "Linux"],
];
const DEVICES: Record<string, string> = { desktop: "Desktop", mobile: "Mobile", tablet: "Tablet" };

/** Raw property value → a major name (never a version) or Other. */
export function normalizeCategory(dim: BreakdownDimension, raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 100) return OTHER;
  if (dim === "device") return DEVICES[raw.trim().toLowerCase()] ?? OTHER;
  for (const [re, name] of dim === "browser" ? BROWSERS : OSES) if (re.test(raw)) return name;
  return OTHER;
}

export type Bucket = { name: string; total: number };

/**
 * Normalizes, merges and folds every named bucket below MIN_BUCKET events
 * into Other. Sorted by size, Other last.
 */
export function foldBuckets(dim: BreakdownDimension, rows: Rows, min = MIN_BUCKET): Bucket[] | null {
  const merged = new Map<string, number>();
  for (const r of rows) {
    const total = count(r[1]);
    if (total === null) return null;
    const name = normalizeCategory(dim, r[0]);
    merged.set(name, (merged.get(name) ?? 0) + total);
  }
  let other = merged.get(OTHER) ?? 0;
  merged.delete(OTHER);
  const named: Bucket[] = [];
  for (const [name, total] of merged) {
    if (total < min) other += total;
    else named.push({ name, total });
  }
  named.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return other > 0 ? [...named, { name: OTHER, total: other }] : named;
}

// ── assembly ─────────────────────────────────────────────────────────────────
export type Section<T> = { ok: true; data: T } | { ok: false };
const fail = { ok: false } as const;
const okv = <T>(data: T | null): Section<T> => (data === null ? fail : { ok: true, data });

export type DailyPoint = { day: string; pageviews: number; sessions: number | null };

export interface DashboardData {
  kpis: Section<{ pageviews: number; sessions: number; started: number; confirmed: number }>;
  daily: Section<{ points: DailyPoint[]; source: "trends" | "hogql" }>;
  funnel: Section<{
    started: number;
    confirmed: number;
    dropOff: number;
    conversion: number | null;
    mode: "funnel" | "totals";
  }>;
  topPaths: Section<{ path: string; views: number }[]>;
  breakdowns: Record<BreakdownDimension, Section<Bucket[]>>;
  exceptions: Section<{ points: { day: string; count: number }[]; total: number }>;
  exceptionTypes: Section<{ type: string; total: number }[]>;
}

export type DashboardResult =
  | { state: "not-configured"; reason: "missing" | "invalid"; range: RangeDays }
  | { state: "rejected"; range: RangeDays }
  | { state: "missing-scope"; scope: string; range: RangeDays }
  | { state: "ok"; data: DashboardData; range: RangeDays };

/** Inclusive list of YYYY-MM-DD days ending at `last`. */
export function dayAxis(last: string, days: number): string[] {
  const end = Date.parse(`${last}T00:00:00Z`);
  if (!Number.isFinite(end)) return [];
  return Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/** Runs tasks with bounded concurrency; results keep their order. */
export async function pool<T>(tasks: (() => Promise<T>)[], limit = MAX_CONCURRENCY): Promise<PromiseSettledResult<T>[]> {
  const out: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await tasks[i]() };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

const TREND_EVENTS = ["$pageview", "$exception"];
const FUNNEL_EVENTS = ["registration_started", "free_registration_confirmed"];
export const DASHBOARD_TASKS = ["trends", "funnel", "traffic", "totals", "daily", "topPaths", "browser", "os", "device", "exceptionTypes"] as const;
type TaskName = (typeof DASHBOARD_TASKS)[number];

/** Loads every section independently for the given range. */
export async function loadDashboard(
  env: DashboardEnv,
  range: RangeDays,
  fetchImpl: FetchLike,
  today: () => string = () => new Date().toISOString().slice(0, 10),
): Promise<DashboardResult> {
  const cfg = parseDashboardConfig(env);
  if (!cfg.ok) return { state: "not-configured", reason: cfg.reason, range };
  const q = hogqlQueries(range);
  const run = (node: QueryNode) => () => postQuery(cfg.config, node, fetchImpl);
  const hog = (name: HogQLName) => run({ kind: "HogQLQuery", query: q[name] });
  const nodes: Record<TaskName, () => Promise<unknown>> = {
    trends: run(trendsQuery(range)),
    funnel: run(funnelsQuery(range)),
    traffic: hog("traffic"),
    totals: hog("totals"),
    daily: hog("daily"),
    topPaths: hog("topPaths"),
    browser: hog("browser"),
    os: hog("os"),
    device: hog("device"),
    exceptionTypes: hog("exceptionTypes"),
  };
  const settled = await pool(DASHBOARD_TASKS.map((n) => nodes[n]));

  // Every call failed the same way → page-level state instead of empty panels.
  const errors = settled.map((s) => (s.status === "rejected" ? s.reason : null));
  if (errors.every((e) => e instanceof ProviderError && e.kind === "missing-scope")) {
    return { state: "missing-scope", scope: (errors[0] as ProviderError).scope ?? "query:read", range };
  }
  if (errors.every((e) => e instanceof ProviderError && e.kind !== "failed")) return { state: "rejected", range };

  const body = {} as Record<TaskName, unknown>;
  DASHBOARD_TASKS.forEach((n, i) => {
    const s = settled[i];
    body[n] = s.status === "fulfilled" ? s.value : undefined;
  });
  const parse = <T>(n: TaskName, fn: (r: Rows) => T | null): T | null => {
    const r = body[n] === undefined ? null : hogqlRows(body[n]);
    return r === null ? null : fn(r);
  };

  const traffic = parse("traffic", parseTraffic);
  const totals = parse("totals", parseTotals);
  const daily = parse("daily", parseDaily);
  const trends = body.trends === undefined ? null : parseTrends(body.trends, TREND_EVENTS);
  const funnel = body.funnel === undefined ? null : parseFunnel(body.funnel, FUNNEL_EVENTS);

  // Daily pageviews/sessions: Trends axis + HogQL unique sessions; HogQL alone as fallback.
  let dailySection: DashboardData["daily"] = fail;
  const byDay = new Map((daily ?? []).map((d) => [d.day, d]));
  if (trends) {
    const pv = trends.$pageview;
    dailySection = {
      ok: true,
      data: {
        source: "trends",
        points: pv.days.map((day, i) => ({
          day,
          pageviews: pv.values[i],
          sessions: daily ? (byDay.get(day)?.sessions ?? 0) : null,
        })),
      },
    };
  } else if (daily) {
    const last = [...byDay.keys(), today()].sort().at(-1)!;
    dailySection = {
      ok: true,
      data: {
        source: "hogql",
        points: dayAxis(last, range).map((day) => ({
          day,
          pageviews: byDay.get(day)?.pageviews ?? 0,
          sessions: byDay.get(day)?.sessions ?? 0,
        })),
      },
    };
  }

  // Exceptions per day: the Trends series, else one extra HogQL fallback query.
  let exceptions: DashboardData["exceptions"] = fail;
  if (trends) {
    const ex = trends.$exception;
    exceptions = {
      ok: true,
      data: { points: ex.days.map((day, i) => ({ day, count: ex.values[i] })), total: ex.values.reduce((a, b) => a + b, 0) },
    };
  } else {
    try {
      const r = hogqlRows(await hog("dailyExceptions")());
      const parsed = r ? parseDailyCounts(r) : null;
      if (parsed) {
        const counts = new Map(parsed.map((p) => [p.day, p.count]));
        const last = [...counts.keys(), today()].sort().at(-1)!;
        const points = dayAxis(last, range).map((day) => ({ day, count: counts.get(day) ?? 0 }));
        exceptions = { ok: true, data: { points, total: points.reduce((a, p) => a + p.count, 0) } };
      }
    } catch {
      // Section stays failed.
    }
  }

  const funnelData = funnel
    ? { ...funnel, mode: "funnel" as const }
    : totals
      ? { started: totals.started, confirmed: Math.min(totals.confirmed, totals.started), mode: "totals" as const }
      : null;

  return {
    state: "ok",
    range,
    data: {
      kpis: okv(
        traffic && totals
          ? { pageviews: traffic.pageviews, sessions: traffic.sessions, started: totals.started, confirmed: totals.confirmed }
          : null,
      ),
      daily: dailySection,
      funnel: okv(
        funnelData
          ? {
              ...funnelData,
              dropOff: funnelData.started - funnelData.confirmed,
              conversion: funnelData.started > 0 ? funnelData.confirmed / funnelData.started : null,
            }
          : null,
      ),
      topPaths: okv(parse("topPaths", parseTopPaths)),
      breakdowns: {
        browser: okv(parse("browser", (r) => foldBuckets("browser", r))),
        os: okv(parse("os", (r) => foldBuckets("os", r))),
        device: okv(parse("device", (r) => foldBuckets("device", r))),
      },
      exceptions,
      exceptionTypes: okv(parse("exceptionTypes", parseExceptionTypes)),
    },
  };
}
