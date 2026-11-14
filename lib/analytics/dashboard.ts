/**
 * Super-admin analytics dashboard data (D-025). Pure apart from the injected
 * `fetch`; the server-only wrapper lives in lib/data/analytics-dashboard.ts.
 *
 * Reads AGGREGATES from PostHog Cloud EU's private Query API (HogQL) with a
 * server-only personal API key (scope: query:read) and project ID. Queries
 * select counts and public paths only — never person/distinct IDs, sessions,
 * replays or raw exception payloads. Missing or rejected configuration fails
 * closed to a clear state instead of throwing.
 */
import { isAnalyticsRoute, normalizePathname } from "./routes.ts";
import { redactText } from "./redact.ts";

/** PostHog Cloud EU app/API host (private API; not the ingestion host). */
export const POSTHOG_EU_APP_HOST = "https://eu.posthog.com";
export const DASHBOARD_WINDOW_DAYS = 30;

export interface DashboardConfig {
  apiKey: string;
  projectId: string;
}

export type ConfigResult = { ok: true; config: DashboardConfig } | { ok: false; reason: "missing" | "invalid" };

/** Personal API keys start with `phx_`; project IDs are numeric. */
export function parseDashboardConfig(env: {
  POSTHOG_PERSONAL_API_KEY?: string;
  POSTHOG_PROJECT_ID?: string;
}): ConfigResult {
  const apiKey = (env.POSTHOG_PERSONAL_API_KEY ?? "").trim();
  const projectId = (env.POSTHOG_PROJECT_ID ?? "").trim();
  if (!apiKey || !projectId) return { ok: false, reason: "missing" };
  if (!/^phx_[A-Za-z0-9]{20,100}$/.test(apiKey) || !/^\d{1,12}$/.test(projectId)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, config: { apiKey, projectId } };
}

const W = `timestamp >= now() - INTERVAL ${DASHBOARD_WINDOW_DAYS} DAY`;

/** The only queries the dashboard runs (aggregates only). */
export const DASHBOARD_QUERIES = {
  traffic: `SELECT count() AS pageviews, count(DISTINCT properties.$session_id) AS sessions FROM events WHERE event = '$pageview' AND ${W}`,
  topPaths: `SELECT properties.$pathname AS path, count() AS views FROM events WHERE event = '$pageview' AND ${W} GROUP BY path ORDER BY views DESC LIMIT 25`,
  funnel: `SELECT countIf(event = 'registration_started') AS started, countIf(event = 'free_registration_confirmed') AS confirmed FROM events WHERE event IN ('registration_started', 'free_registration_confirmed') AND ${W}`,
  exceptions: `SELECT count() AS total FROM events WHERE event = '$exception' AND ${W}`,
  exceptionTypes: `SELECT JSONExtractString(properties.$exception_list, 1, 'type') AS type, count() AS total FROM events WHERE event = '$exception' AND ${W} GROUP BY type ORDER BY total DESC LIMIT 10`,
} as const;
export type QueryName = keyof typeof DASHBOARD_QUERIES;

export type Section<T> = { ok: true; data: T } | { ok: false };

export interface DashboardData {
  traffic: Section<{ pageviews: number; sessions: number }>;
  topPaths: Section<{ path: string; views: number }[]>;
  funnel: Section<{ started: number; confirmed: number; rate: number | null }>;
  exceptions: Section<{ total: number }>;
  exceptionTypes: Section<{ type: string; total: number }[]>;
}

export type DashboardResult =
  | { state: "not-configured"; reason: "missing" | "invalid" }
  | { state: "rejected" }
  | { state: "ok"; data: DashboardData; windowDays: number };

const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : null;

type Rows = unknown[][];

export function parseTraffic(rows: Rows): { pageviews: number; sessions: number } | null {
  const r = rows[0];
  if (!Array.isArray(r)) return null;
  const pageviews = count(r[0]);
  const sessions = count(r[1]);
  return pageviews === null || sessions === null ? null : { pageviews, sessions };
}

/** Public paths only (anything else — odd/legacy values — is excluded). */
export function parseTopPaths(rows: Rows): { path: string; views: number }[] | null {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!Array.isArray(r)) return null;
    const path = normalizePathname(typeof r[0] === "string" ? r[0] : null);
    const views = count(r[1]);
    if (views === null) return null;
    if (!path || !isAnalyticsRoute(path)) continue;
    out.set(path, (out.get(path) ?? 0) + views);
  }
  return [...out.entries()]
    .map(([path, views]) => ({ path, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);
}

export function parseFunnel(rows: Rows): { started: number; confirmed: number; rate: number | null } | null {
  const r = rows[0];
  if (!Array.isArray(r)) return null;
  const started = count(r[0]);
  const confirmed = count(r[1]);
  if (started === null || confirmed === null) return null;
  return { started, confirmed, rate: started > 0 ? Math.min(confirmed / started, 1) : null };
}

export function parseExceptionTotal(rows: Rows): { total: number } | null {
  const total = Array.isArray(rows[0]) ? count(rows[0][0]) : null;
  return total === null ? null : { total };
}

/** Type names only, re-redacted and shortened; never messages or stacks. */
export function parseExceptionTypes(rows: Rows): { type: string; total: number }[] | null {
  const out: { type: string; total: number }[] = [];
  for (const r of rows) {
    if (!Array.isArray(r)) return null;
    const total = count(r[1]);
    if (total === null) return null;
    const raw = typeof r[0] === "string" && r[0].trim() ? r[0] : "Unknown";
    const type = (redactText(raw, 60) ?? "Unknown").replace(/[^\w.$:[\]-]+/g, " ").trim() || "Unknown";
    out.push({ type, total });
  }
  return out;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal; cache?: "no-store" }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

class Rejected extends Error {}

async function runQuery(config: DashboardConfig, query: string, fetchImpl: FetchLike): Promise<Rows> {
  const res = await fetchImpl(`${POSTHOG_EU_APP_HOST}/api/projects/${config.projectId}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(10_000) : undefined,
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) throw new Rejected();
  if (!res.ok) throw new Error(`query failed (${res.status})`);
  const body = (await res.json()) as { results?: unknown };
  if (!body || !Array.isArray(body.results)) throw new Error("malformed response");
  return body.results as Rows;
}

const PARSERS = {
  traffic: parseTraffic,
  topPaths: parseTopPaths,
  funnel: parseFunnel,
  exceptions: parseExceptionTotal,
  exceptionTypes: parseExceptionTypes,
} as const;

/** Loads every card independently; a failing query only blanks its own card. */
export async function loadDashboard(
  env: { POSTHOG_PERSONAL_API_KEY?: string; POSTHOG_PROJECT_ID?: string },
  fetchImpl: FetchLike,
): Promise<DashboardResult> {
  const cfg = parseDashboardConfig(env);
  if (!cfg.ok) return { state: "not-configured", reason: cfg.reason };
  const names = Object.keys(DASHBOARD_QUERIES) as QueryName[];
  const settled = await Promise.allSettled(names.map((n) => runQuery(cfg.config, DASHBOARD_QUERIES[n], fetchImpl)));
  if (settled.every((s) => s.status === "rejected" && s.reason instanceof Rejected)) return { state: "rejected" };
  const data = {} as Record<QueryName, Section<unknown>>;
  names.forEach((n, i) => {
    const s = settled[i];
    if (s.status !== "fulfilled") {
      data[n] = { ok: false };
      return;
    }
    const parsed = (PARSERS[n] as (rows: Rows) => unknown)(s.value);
    data[n] = parsed === null ? { ok: false } : { ok: true, data: parsed };
  });
  return { state: "ok", data: data as unknown as DashboardData, windowDays: DASHBOARD_WINDOW_DAYS };
}
