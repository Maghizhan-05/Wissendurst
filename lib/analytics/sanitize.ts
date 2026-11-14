/**
 * Pre-send sanitizer for every PostHog event (D-024). Pure; wired as the
 * SDK's `before_send` hook, so nothing leaves the browser without passing
 * through here.
 *
 *  - Only allow-listed events are sent; anything else is dropped.
 *  - Only allow-listed property keys survive; unknown keys are removed.
 *  - URLs are reduced to the same-origin pathname (no query, hash or
 *    referrer); events whose page is not an approved analytics route are
 *    dropped entirely.
 *  - Values shaped like personal data (emails, phones, UUIDs outside
 *    PostHog's own anonymous ids, participant IDs, UTR/payment references,
 *    filenames, uploaded/storage URLs, raw errors) are removed.
 *  - Person properties ($set / $set_once) are never sent.
 */
import { eventSlugFromPath, isAnalyticsRoute, normalizePathname } from "./routes.ts";
import { sanitizeExceptionLevel, sanitizeExceptionList } from "./redact.ts";

/** Product events (typed in ./events). */
export const CUSTOM_EVENTS = [
  "consent_granted",
  "consent_denied",
  "registration_started",
  "free_registration_confirmed",
] as const;
export type CustomEventName = (typeof CUSTOM_EVENTS)[number];

/** PostHog events produced by the enabled features. */
export const SYSTEM_EVENTS = ["$pageview", "$pageleave", "$autocapture", "$$heatmap", "$snapshot", "$exception"] as const;

const ALLOWED_EVENTS = new Set<string>([...CUSTOM_EVENTS, ...SYSTEM_EVENTS]);

/** The only product properties: public event slug/category and coarse team info. */
export const PRODUCT_PROPERTIES = ["event_slug", "event_category", "team", "team_size"] as const;

/** PostHog's own anonymous identifiers (UUID-shaped by design). */
const ANONYMOUS_ID_KEYS = new Set([
  "distinct_id",
  "$device_id",
  "$session_id",
  "$window_id",
  "$pageview_id",
  "$insert_id",
  "$prev_pageview_id",
]);

/** Context PostHog attaches to every event; values are re-checked below. */
const COMMON_KEYS = new Set([
  "token",
  ...ANONYMOUS_ID_KEYS,
  "$time",
  "$lib",
  "$lib_version",
  "$browser",
  "$browser_version",
  "$browser_language",
  "$browser_language_prefix",
  "$os",
  "$os_version",
  "$device_type",
  "$screen_height",
  "$screen_width",
  "$viewport_height",
  "$viewport_width",
  "$timezone",
  "$timezone_offset",
  "$current_url",
  "$host",
  "$pathname",
  "$is_identified",
  "$process_person_profile",
  "$configured_session_timeout_ms",
  "$recording_status",
  "$replay_sample_rate",
  "$replay_minimum_duration",
  "$replay_script_version",
  "$lib_rate_limit_remaining_tokens",
]);

const SCROLL_KEYS = [
  "$prev_pageview_pathname",
  "$prev_pageview_duration",
  "$prev_pageview_last_scroll",
  "$prev_pageview_last_scroll_percentage",
  "$prev_pageview_max_scroll",
  "$prev_pageview_max_scroll_percentage",
  "$prev_pageview_last_content",
  "$prev_pageview_last_content_percentage",
  "$prev_pageview_max_content",
  "$prev_pageview_max_content_percentage",
];

const EVENT_KEYS: Record<string, readonly string[]> = {
  $pageview: SCROLL_KEYS,
  $pageleave: SCROLL_KEYS,
  $autocapture: ["$event_type", "$ce_version", "$elements", "$elements_chain"],
  $$heatmap: ["$heatmap_data"],
  $snapshot: ["$snapshot_data", "$snapshot_bytes", "$snapshot_source"],
  // D-025: redacted exception list + level + build release id only.
  $exception: ["$exception_list", "$exception_level", "$release_id"],
  consent_granted: [],
  consent_denied: [],
  registration_started: PRODUCT_PROPERTIES,
  free_registration_confirmed: PRODUCT_PROPERTIES,
};

// ── personal-data shapes ─────────────────────────────────────────────────────
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const EMAIL = /[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/i;
const PARTICIPANT_ID = /\b(?:W27\s*\/\s*(?:E|GR)\s*\/\s*\d+|(?:sup)?admin\s*\/\s*\d+)\b/i;
const PHONE = /(?:\+?\d[\s-]?){10,}/;
const LONG_NUMBER = /\d{9,}/; // UTR / bank / transaction references
const PAYMENT_WORDS = /\b(?:utr|upi|txn|transaction|payment[_ -]?ref|ref(?:erence)?[_ -]?no|razorpay|pay_[a-z0-9]+)\b/i;
const FILENAME = /\.(?:png|jpe?g|gif|webp|heic|heif|avif|bmp|tiff?|pdf|docx?|xlsx?|csv|zip)\b/i;
const UPLOAD_URL = /(?:\/storage\/v1\/|supabase\.(?:co|in)|blob:|data:|\/object\/(?:sign|public)\/)/i;
const RAW_ERROR = /\b(?:error|exception|stack\s*trace|traceback|undefined is not|cannot read propert)/i;
const AT_UPI = /[a-z0-9._-]{2,}@[a-z]{2,}/i; // UPI handle (name@bank)

/** True when a string looks like personal/payment data or a raw error. */
export function isPiiShaped(value: string): boolean {
  return (
    UUID.test(value) ||
    EMAIL.test(value) ||
    AT_UPI.test(value) ||
    PARTICIPANT_ID.test(value) ||
    PHONE.test(value) ||
    LONG_NUMBER.test(value) ||
    PAYMENT_WORDS.test(value) ||
    FILENAME.test(value) ||
    UPLOAD_URL.test(value) ||
    RAW_ERROR.test(value)
  );
}

/** Property names that suggest personal data (any unknown key is dropped anyway). */
const PII_KEY = /(?:e-?mail|phone|mobile|name|utr|upi|txn|transaction|payment|amount|participant|profile|user|token(?!$)|password|card|address|college|file|upload|screenshot|photo|image|error|message|value|query|search|referr?er|ip)/i;
export function isPiiKeyName(key: string): boolean {
  return PII_KEY.test(key);
}

// ── URLs ─────────────────────────────────────────────────────────────────────
/** Same-origin URL → origin + normalized pathname; anything else → null. */
export function sanitizeUrl(raw: unknown, origin: string): string | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw, origin);
  } catch {
    return null;
  }
  if (u.origin !== origin) return null;
  const p = normalizePathname(u.pathname);
  return p ? origin + (p === "/" ? "/" : p) : null;
}

/** Same-origin href → pathname only; external/mailto/tel/etc → null. */
export function sanitizeHref(raw: unknown, origin: string): string | null {
  const url = sanitizeUrl(raw, origin);
  return url ? url.slice(origin.length) || "/" : null;
}

// ── autocapture elements ─────────────────────────────────────────────────────
const ELEMENT_ATTRS = new Set(["attr__class", "attr__type", "attr__role", "attr__href"]);
const CLASS_TOKEN = /^[A-Za-z0-9_:/.[\]()%#!-]{1,60}$/;

function cleanClassList(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const tokens = v.split(/\s+/).filter((t) => t && CLASS_TOKEN.test(t) && !isPiiShaped(t));
  return tokens.length ? tokens.slice(0, 40).join(" ") : null;
}

type ElementProps = Record<string, unknown>;

function sanitizeElement(el: unknown, origin: string): ElementProps | null {
  if (!el || typeof el !== "object") return null;
  const src = el as ElementProps;
  const tag = typeof src.tag_name === "string" && /^[a-z][a-z0-9-]{0,30}$/.test(src.tag_name) ? src.tag_name : null;
  if (!tag) return null;
  const out: ElementProps = { tag_name: tag };
  for (const k of ["nth_child", "nth_of_type"]) if (Number.isInteger(src[k])) out[k] = src[k];
  if (Array.isArray(src.classes)) {
    const classes = (src.classes as unknown[]).filter(
      (c): c is string => typeof c === "string" && CLASS_TOKEN.test(c) && !isPiiShaped(c),
    );
    if (classes.length) out.classes = classes.slice(0, 40);
  }
  for (const k of ELEMENT_ATTRS) {
    if (!(k in src)) continue;
    if (k === "attr__href") {
      const href = sanitizeHref(src[k], origin);
      if (href) out[k] = href;
    } else if (k === "attr__class") {
      const c = cleanClassList(src[k]);
      if (c) out[k] = c;
    } else if (typeof src[k] === "string" && /^[a-z-]{1,30}$/.test(src[k] as string)) {
      out[k] = src[k];
    }
  }
  return out;
}

/** Parses PostHog's `$elements_chain` string into elements (null if malformed). */
export function parseElementsChain(chain: string): { tag: string; classes: string[]; attrs: Record<string, string> }[] | null {
  const out: { tag: string; classes: string[]; attrs: Record<string, string> }[] = [];
  let i = 0;
  while (i < chain.length) {
    const colon = chain.indexOf(":", i);
    if (colon < 0) return null;
    const head = chain.slice(i, colon);
    const [tag, ...classes] = head.split(".");
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(tag)) return null;
    i = colon + 1;
    const attrs: Record<string, string> = {};
    while (i < chain.length && chain[i] !== ";") {
      const eq = chain.indexOf('="', i);
      if (eq < 0) return null;
      const key = chain.slice(i, eq);
      if (!/^[A-Za-z0-9_:-]{1,80}$/.test(key)) return null;
      let j = eq + 2;
      let val = "";
      for (; j < chain.length; j++) {
        if (chain[j] === "\\" && j + 1 < chain.length) {
          val += chain[j + 1];
          j++;
        } else if (chain[j] === '"') break;
        else val += chain[j];
      }
      if (j >= chain.length) return null;
      attrs[key] = val;
      i = j + 1;
    }
    out.push({ tag, classes, attrs });
    if (chain[i] === ";") i++;
  }
  return out;
}

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Rebuilds a chain keeping only tag, classes, nth-*, and same-origin href paths. */
export function sanitizeElementsChain(chain: unknown, origin: string): string | null {
  if (typeof chain !== "string" || chain.length === 0 || chain.length > 20000) return null;
  const parsed = parseElementsChain(chain);
  if (!parsed) return null;
  return parsed
    .map(({ tag, classes, attrs }) => {
      const cls = classes.filter((c) => c && CLASS_TOKEN.test(c) && !isPiiShaped(c)).sort();
      const kept: Record<string, string> = {};
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "nth-child" || k === "nth-of-type") {
          if (/^\d{1,4}$/.test(v)) kept[k] = v;
        } else if (k === "href" || k === "attr__href") {
          const h = sanitizeHref(v, origin);
          if (h) kept[k] = h;
        } else if (k === "attr__class") {
          const c = cleanClassList(v);
          if (c) kept[k] = c;
        } else if ((k === "attr__type" || k === "attr__role") && /^[a-z-]{1,30}$/.test(v)) {
          kept[k] = v;
        }
      }
      const pairs = Object.keys(kept)
        .sort()
        .map((k) => `${k}="${esc(kept[k])}"`)
        .join("");
      return `${tag}${cls.map((c) => "." + c).join("")}:${pairs}`;
    })
    .join(";");
}

// ── heatmaps / replay ────────────────────────────────────────────────────────
function sanitizeHeatmapData(data: unknown, origin: string): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  const out: Record<string, unknown[]> = {};
  for (const [url, points] of Object.entries(data as Record<string, unknown>)) {
    const clean = sanitizeUrl(url, origin);
    if (!clean || !isAnalyticsRoute(clean.slice(origin.length) || "/") || !Array.isArray(points)) continue;
    const safe = points
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((p) => {
        const q: Record<string, unknown> = {};
        for (const k of ["x", "y", "target_fixed", "type"]) if (k in p) q[k] = p[k];
        return q;
      })
      .filter((q) => typeof q.x === "number" && typeof q.y === "number" && (q.type === "click" || q.type === "mousemove" || q.type === "rageclick"));
    if (safe.length) (out[clean] ??= []).push(...safe);
  }
  return Object.keys(out).length ? out : null;
}

/** rrweb Meta events carry the page URL: reduce it like every other URL. */
function sanitizeSnapshotData(data: unknown, origin: string): unknown[] | null {
  if (!Array.isArray(data)) return null;
  const out: unknown[] = [];
  for (const ev of data) {
    if (!ev || typeof ev !== "object") continue;
    const e = ev as { type?: unknown; data?: Record<string, unknown> };
    if (e.type === 4 && e.data && typeof e.data === "object") {
      const href = sanitizeUrl(e.data.href, origin);
      if (!href || !isAnalyticsRoute(href.slice(origin.length) || "/")) continue;
      out.push({ ...e, data: { ...e.data, href } });
    } else {
      out.push(ev);
    }
  }
  return out;
}

// ── product properties ───────────────────────────────────────────────────────
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function productValue(key: string, value: unknown): unknown {
  switch (key) {
    case "event_slug":
    case "event_category":
      return typeof value === "string" && value.length <= 120 && SLUG.test(value) && !isPiiShaped(value)
        ? value
        : undefined;
    case "team":
      return typeof value === "boolean" ? value : undefined;
    case "team_size":
      return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 10 ? value : undefined;
    default:
      return undefined;
  }
}

// ── the hook ─────────────────────────────────────────────────────────────────
export interface CaptureLike {
  event: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SanitizeContext {
  /** window.location.origin */
  origin: string;
  /** window.location.pathname at send time */
  pathname: string;
}

/**
 * Returns a cleaned copy of the event, or null to drop it. The event is
 * dropped unless the CURRENT page is an approved analytics route.
 */
export function sanitizeEvent<T extends CaptureLike>(result: T | null, ctx: SanitizeContext): T | null {
  if (!result || typeof result.event !== "string" || !ALLOWED_EVENTS.has(result.event)) return null;
  const page = normalizePathname(ctx.pathname);
  if (!page || !isAnalyticsRoute(page)) return null;

  const src = result.properties ?? {};
  const allowedForEvent = new Set(EVENT_KEYS[result.event] ?? []);
  const props: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(src)) {
    if (!(COMMON_KEYS.has(key) || allowedForEvent.has(key))) continue;
    if ((PRODUCT_PROPERTIES as readonly string[]).includes(key)) {
      const v = productValue(key, value);
      if (v !== undefined) props[key] = v;
      continue;
    }
    switch (key) {
      case "$current_url":
        props[key] = ctx.origin + (page === "/" ? "/" : page);
        continue;
      case "$pathname":
        props[key] = page;
        continue;
      case "$host":
        props[key] = new URL(ctx.origin).host;
        continue;
      case "$prev_pageview_pathname": {
        const p = normalizePathname(typeof value === "string" ? value : null);
        if (p && isAnalyticsRoute(p)) props[key] = p;
        continue;
      }
      case "$elements": {
        if (!Array.isArray(value)) continue;
        const els = value.map((el) => sanitizeElement(el, ctx.origin)).filter((e): e is ElementProps => e !== null);
        if (els.length) props[key] = els;
        continue;
      }
      case "$elements_chain": {
        const c = sanitizeElementsChain(value, ctx.origin);
        if (c) props[key] = c;
        continue;
      }
      case "$heatmap_data": {
        const h = sanitizeHeatmapData(value, ctx.origin);
        if (h) props[key] = h;
        continue;
      }
      case "$snapshot_data": {
        const s = sanitizeSnapshotData(value, ctx.origin);
        if (s) props[key] = s;
        continue;
      }
      case "$event_type":
        if (value === "click" || value === "submit") props[key] = value;
        continue;
      case "$exception_list": {
        const list = sanitizeExceptionList(value, ctx.origin);
        if (list) props[key] = list;
        continue;
      }
      case "$exception_level": {
        const level = sanitizeExceptionLevel(value);
        if (level) props[key] = level;
        continue;
      }
      case "$release_id":
        if (typeof value === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(value)) props[key] = value;
        continue;
    }
    if (typeof value === "string") {
      if (ANONYMOUS_ID_KEYS.has(key) || key === "token") {
        if (/^[A-Za-z0-9_-]{1,100}$/.test(value)) props[key] = value;
      } else if (value.length <= 200 && !isPiiShaped(value)) {
        props[key] = value;
      }
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      props[key] = value;
    }
  }

  if (result.event === "$autocapture" && props.$event_type === undefined) return null;
  if (result.event === "$$heatmap" && !props.$heatmap_data) return null;
  if (result.event === "$snapshot" && !props.$snapshot_data) return null;
  if (result.event === "$exception" && !props.$exception_list) return null;

  const clean = { ...result, properties: props } as T;
  delete (clean as Record<string, unknown>).$set;
  delete (clean as Record<string, unknown>).$set_once;
  return clean;
}

/** The product properties an event page may attach (slug from its own URL). */
export function eventPageProperties(pathname: string, category: string | null | undefined) {
  const slug = eventSlugFromPath(pathname);
  return {
    ...(slug ? { event_slug: slug } : {}),
    ...(category && SLUG.test(category) ? { event_category: category } : {}),
  };
}
