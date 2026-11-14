/**
 * Saved PostHog heatmaps (D-026). Pure apart from the injected `fetch`.
 *
 * Contract (PostHog EU OpenAPI `/api/schema/`, heatmap:read only):
 *   GET /api/projects/:project_id/saved/                     → saved heatmaps
 *   GET /api/projects/:project_id/saved/:short_id/           → one saved heatmap
 *   GET /api/projects/:project_id/heatmap_screenshots/:id/content/?width=
 *       → 200 JPEG bytes | 202 metadata while still rendering
 * Wissendurst never creates, regenerates or edits heatmaps (no write scope is
 * not requested). Only same-origin entries for the approved public routes
 * are shown; creator identity, raw provider errors and query/hash data are
 * dropped. Click/scroll overlays (/heatmaps/) are NOT implemented: their
 * live response shape has not been observed (see README).
 */
import { isAnalyticsRoute, normalizePathname } from "./routes.ts";
import { redactText } from "./redact.ts";
import {
  POSTHOG_EU_APP_HOST,
  QUERY_REVALIDATE_SECONDS,
  ProviderError,
  authHeaders,
  classifyFailure,
  timeoutSignal,
  type DashboardConfig,
  type FetchLike,
} from "./dashboard.ts";

export const MIN_WIDTH = 100;
export const MAX_WIDTH = 3000;
export const DEFAULT_WIDTH = 1024;
export const MAX_LISTED = 24;
/** Upper bound for a proxied screenshot (full-page JPEGs can be tall). */
export const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024;
export const SCREENSHOT_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const isHeatmapUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export const isShortId = (v: unknown): v is string => typeof v === "string" && SHORT_ID.test(v);

/** `?width=` → integer in [100, 3000], else null. */
export function parseWidth(input: unknown): number | null {
  const v = Array.isArray(input) ? input[0] : input;
  if (typeof v !== "string" || !/^\d{3,4}$/.test(v)) return null;
  const n = Number(v);
  return n >= MIN_WIDTH && n <= MAX_WIDTH ? n : null;
}

/**
 * The site's own origins: NEXT_PUBLIC_SITE_URL plus Vercel's production
 * domain. Only https (or http://localhost for development).
 */
export function siteOrigins(env: { NEXT_PUBLIC_SITE_URL?: string; VERCEL_PROJECT_PRODUCTION_URL?: string }): string[] {
  const out = new Set<string>();
  const add = (raw: string | undefined) => {
    if (!raw) return;
    try {
      const u = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
      if (u.protocol === "https:" || (u.protocol === "http:" && u.hostname === "localhost")) out.add(u.origin);
    } catch {
      // ignore malformed values
    }
  };
  add(env.NEXT_PUBLIC_SITE_URL);
  add(env.VERCEL_PROJECT_PRODUCTION_URL);
  return [...out];
}

export type HeatmapStatus = "processing" | "completed" | "failed";

/** Safe, creator-free view of a saved heatmap. */
export interface SavedHeatmap {
  id: string;
  shortId: string;
  name: string | null;
  path: string;
  status: HeatmapStatus;
  /** Widths whose render is ready to fetch. */
  readyWidths: number[];
  /** All requested widths. */
  targetWidths: number[];
  updatedAt: string | null;
}

const width = (v: unknown): number | null =>
  Number.isInteger(v) && (v as number) >= MIN_WIDTH && (v as number) <= MAX_WIDTH ? (v as number) : null;

/** One API object → SavedHeatmap, or null (malformed, cross-origin, non-public, deleted, not a screenshot). */
export function parseSavedHeatmap(raw: unknown, origins: string[]): SavedHeatmap | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isHeatmapUuid(r.id) || !isShortId(r.short_id) || typeof r.url !== "string") return null;
  if (r.deleted === true) return null;
  if (r.type !== undefined && r.type !== "screenshot") return null;
  let u: URL;
  try {
    u = new URL(r.url);
  } catch {
    return null;
  }
  if (!origins.includes(u.origin)) return null;
  const path = normalizePathname(u.pathname);
  if (!path || !isAnalyticsRoute(path)) return null;
  const status: HeatmapStatus | null =
    r.status === "processing" || r.status === "completed" || r.status === "failed" ? r.status : null;
  if (!status) return null;
  const targetWidths = Array.isArray(r.target_widths)
    ? [...new Set(r.target_widths.map(width).filter((w): w is number => w !== null))].sort((a, b) => a - b)
    : [];
  const readyWidths = Array.isArray(r.snapshots)
    ? [
        ...new Set(
          r.snapshots
            .filter((s) => s && typeof s === "object" && (s as { has_content?: unknown }).has_content === true)
            .map((s) => width((s as { width?: unknown }).width))
            .filter((w): w is number => w !== null),
        ),
      ].sort((a, b) => a - b)
    : [];
  const name = typeof r.name === "string" && r.name.trim() ? (redactText(r.name.trim(), 80) ?? null) : null;
  const updatedAt = typeof r.updated_at === "string" && !Number.isNaN(Date.parse(r.updated_at)) ? r.updated_at : null;
  // Deliberately dropped: created_by (creator identity), exception (raw
  // provider error), data_url, source, user_access_level, query/hash.
  return { id: r.id.toLowerCase(), shortId: r.short_id, name, path, status, readyWidths, targetWidths, updatedAt };
}

/**
 * List body → items. The documented body is `{count, results}`; the
 * generated OpenAPI also describes an array wrapper, so both are accepted.
 */
export function listItems(body: unknown): unknown[] | null {
  if (Array.isArray(body)) {
    if (body.length === 1 && body[0] && typeof body[0] === "object" && Array.isArray((body[0] as { results?: unknown }).results)) {
      return (body[0] as { results: unknown[] }).results;
    }
    return body;
  }
  const results = (body as { results?: unknown } | null)?.results;
  return Array.isArray(results) ? results : null;
}

export type HeatmapList =
  | { state: "not-configured" }
  | { state: "no-origin" }
  | { state: "missing-scope" }
  | { state: "rejected" }
  | { state: "failed" }
  | { state: "ok"; items: SavedHeatmap[]; hidden: number };

function failureState(e: unknown): "missing-scope" | "rejected" | "failed" {
  return e instanceof ProviderError && (e.kind === "missing-scope" || e.kind === "rejected") ? e.kind : "failed";
}

async function getJson(config: DashboardConfig, path: string, fetchImpl: FetchLike): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(`${POSTHOG_EU_APP_HOST}/api/projects/${config.projectId}${path}`, {
      method: "GET",
      headers: authHeaders(config),
      signal: timeoutSignal(),
      next: { revalidate: QUERY_REVALIDATE_SECONDS },
    });
  } catch {
    throw new ProviderError("failed");
  }
  if (res.status === 404) throw new ProviderError("failed", "not-found");
  if (!res.ok) throw await classifyFailure(res);
  try {
    return await res.json();
  } catch {
    throw new ProviderError("failed");
  }
}

export async function listSavedHeatmaps(
  config: DashboardConfig | null,
  origins: string[],
  fetchImpl: FetchLike,
): Promise<HeatmapList> {
  if (!config) return { state: "not-configured" };
  if (origins.length === 0) return { state: "no-origin" };
  let body: unknown;
  try {
    body = await getJson(config, `/saved/?type=screenshot&order=-updated_at&limit=${MAX_LISTED * 2}`, fetchImpl);
  } catch (e) {
    return { state: failureState(e) };
  }
  const items = listItems(body);
  if (!items) return { state: "failed" };
  const parsed = items.map((i) => parseSavedHeatmap(i, origins));
  const visible = parsed.filter((p): p is SavedHeatmap => p !== null);
  return { state: "ok", items: visible.slice(0, MAX_LISTED), hidden: items.length - visible.length };
}

export type HeatmapDetail =
  | { state: "not-configured" }
  | { state: "not-found" }
  | { state: "missing-scope" }
  | { state: "rejected" }
  | { state: "failed" }
  | { state: "ok"; heatmap: SavedHeatmap };

/** One saved heatmap by short ID (hidden entries are reported as not found). */
export async function getSavedHeatmap(
  config: DashboardConfig | null,
  origins: string[],
  shortId: string,
  fetchImpl: FetchLike,
): Promise<HeatmapDetail> {
  if (!config) return { state: "not-configured" };
  if (!isShortId(shortId) || origins.length === 0) return { state: "not-found" };
  let body: unknown;
  try {
    body = await getJson(config, `/saved/${encodeURIComponent(shortId)}/`, fetchImpl);
  } catch (e) {
    if (e instanceof ProviderError && e.scope === "not-found") return { state: "not-found" };
    return { state: failureState(e) };
  }
  const heatmap = parseSavedHeatmap(body, origins);
  return heatmap && heatmap.shortId === shortId ? { state: "ok", heatmap } : { state: "not-found" };
}

/** Width to request: the asked width if ready, else the ready width closest to it. */
export function chooseWidth(heatmap: SavedHeatmap, asked: number | null): number | null {
  if (heatmap.readyWidths.length === 0) return null;
  const target = asked ?? DEFAULT_WIDTH;
  return heatmap.readyWidths.reduce((best, w) => (Math.abs(w - target) < Math.abs(best - target) ? w : best));
}

export type ScreenshotResult =
  | { kind: "image"; contentType: (typeof SCREENSHOT_CONTENT_TYPES)[number]; body: ReadableStream<Uint8Array>; length: number | null }
  | { kind: "processing" }
  | { kind: "missing-scope" }
  | { kind: "rejected" }
  | { kind: "failed" };

/** Byte-limited pass-through; errors the stream when the limit is exceeded. */
export function limitStream(src: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return src.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > max) controller.error(new Error("too large"));
        else controller.enqueue(chunk);
      },
    }),
  );
}

/** Fetches the screenshot bytes server-side (Bearer key never leaves the server). */
export async function fetchScreenshot(
  config: DashboardConfig,
  id: string,
  widthPx: number,
  fetchImpl: FetchLike,
): Promise<ScreenshotResult> {
  if (!isHeatmapUuid(id) || width(widthPx) === null) return { kind: "failed" };
  let res: Response;
  try {
    res = await fetchImpl(
      `${POSTHOG_EU_APP_HOST}/api/projects/${config.projectId}/heatmap_screenshots/${id.toLowerCase()}/content/?width=${widthPx}`,
      { method: "GET", headers: { ...authHeaders(config), Accept: "image/*" }, signal: timeoutSignal(), cache: "no-store" },
    );
  } catch {
    return { kind: "failed" };
  }
  if (res.status === 202) {
    await res.body?.cancel().catch(() => {});
    return { kind: "processing" };
  }
  if (!res.ok) {
    const e = await classifyFailure(res);
    return { kind: e.kind === "missing-scope" || e.kind === "rejected" ? e.kind : "failed" };
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const contentType = SCREENSHOT_CONTENT_TYPES.find((t) => t === type);
  const lengthHeader = res.headers.get("content-length");
  const length = lengthHeader && /^\d{1,12}$/.test(lengthHeader) ? Number(lengthHeader) : null;
  if (!contentType || !res.body || (length !== null && length > MAX_SCREENSHOT_BYTES)) {
    await res.body?.cancel().catch(() => {});
    return { kind: "failed" };
  }
  return { kind: "image", contentType, body: limitStream(res.body, MAX_SCREENSHOT_BYTES), length };
}

/** Headers for every proxy response (no upstream header is ever forwarded). */
export function proxyHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    ...extra,
  };
}

/** Status + generic JSON body for each non-image outcome. */
export function proxyError(kind: "bad-request" | "not-found" | "not-configured" | "processing" | "missing-scope" | "rejected" | "failed"): {
  status: number;
  body: { error: string };
} {
  const map = {
    "bad-request": [400, "invalid request"],
    "not-found": [404, "not found"],
    "not-configured": [503, "not configured"],
    processing: [202, "processing"],
    "missing-scope": [502, "missing heatmap:read scope"],
    rejected: [502, "credentials rejected"],
    failed: [502, "unavailable"],
  } as const;
  const [status, error] = map[kind];
  return { status, body: { error } };
}
