/**
 * Exception redaction (D-025). Pure.
 *
 * `$exception` events carry error messages and stack traces. Before send,
 * every string in them is redacted (emails, phones, UUIDs, participant/staff
 * IDs, UPI handles, transaction/reference numbers, JWT/token-like strings,
 * URL query/hash data, uploaded/storage URLs and filenames, long numbers),
 * every URL is reduced to a same-origin path, and only a closed set of keys
 * survives. Anything else is dropped.
 */

const MAX_TEXT = 500;
const MAX_EXCEPTIONS = 5;
const MAX_FRAMES = 50;

const RULES: [RegExp, string][] = [
  // Uploaded / storage / data / blob URLs and signed URLs.
  [/\b(?:https?:\/\/[^\s"'<>]*(?:\/storage\/v1\/|supabase\.(?:co|in))[^\s"'<>]*|blob:[^\s"'<>]+|data:[^\s"'<>]+)/gi, "[upload-url]"],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "[token]"],
  // Bearer / key=value secrets.
  [/\b(?:bearer|token|apikey|api_key|access_token|refresh_token|secret|password|authorization)\s*[:=]\s*["']?[^\s"'&,;]+/gi, "[token]"],
  // Emails.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "[email]"],
  // UPI handles (name@bank).
  [/\b[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}\b/g, "[upi]"],
  // UUIDs.
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[uuid]"],
  // Participant / staff IDs.
  [/\bW27\s*\/\s*(?:E|GR)\s*\/\s*\d+\b/gi, "[participant-id]"],
  [/\b(?:sup)?admin\s*\/\s*\d+\b/gi, "[staff-id]"],
  // Transaction / UTR / payment references with a label.
  [/\b(?:utr|txn|transaction|ref(?:erence)?|payment)(?:[\s_#:.-]*(?:id|no|number|ref|reference))*[\s_#:.-]*[A-Za-z0-9]{6,}\b/gi, "[payment-ref]"],
  // Phone numbers.
  [/(?:\+?\d[\s-]?){10,}/g, "[phone]"],
  // Long hex / base64-ish tokens (≥ 24 chars mixing letters and digits).
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g, "[token]"],
  // Long numeric identifiers.
  [/\d{6,}/g, "[number]"],
  // Uploaded-file names (images/documents).
  [/[^\s"'<>/\\]+\.(?:png|jpe?g|gif|webp|heic|heif|avif|bmp|tiff?|pdf|docx?|xlsx?|csv|zip)\b/gi, "[file]"],
];

/** Strips query strings and hashes from any URL-ish text. */
function stripUrlQuery(text: string): string {
  return text.replace(/(\b(?:https?:\/\/|\/)[^\s"'<>?#]*)[?#][^\s"'<>]*/g, "$1");
}

/** Redacts a free-text value (message, function name, type). */
export function redactText(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== "string") return undefined;
  let out = stripUrlQuery(value);
  for (const [re, replacement] of RULES) out = out.replace(re, replacement);
  out = out.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return out.length > max ? out.slice(0, max) + "…" : out;
}

/**
 * A stack-frame filename: same-origin script paths are kept (needed for
 * source maps), other origins/schemes are reduced to a marker.
 */
export function sanitizeFrameFilename(value: unknown, origin: string): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const u = new URL(value, origin);
    if (u.origin !== origin) return u.protocol === "http:" || u.protocol === "https:" ? "[external]" : "[native]";
    if (!/^\/[A-Za-z0-9_./~@-]*$/.test(u.pathname)) return undefined;
    return origin + u.pathname;
  } catch {
    return undefined;
  }
}

const FRAME_STRING_KEYS = new Set(["function", "module"]);
const PLATFORMS = new Set(["web:javascript", "node:javascript"]);

function sanitizeFrame(frame: unknown, origin: string): Record<string, unknown> | null {
  if (!frame || typeof frame !== "object") return null;
  const f = frame as Record<string, unknown>;
  const out: Record<string, unknown> = {
    platform: typeof f.platform === "string" && PLATFORMS.has(f.platform) ? f.platform : "web:javascript",
  };
  for (const k of ["filename", "abs_path"] as const) {
    const v = sanitizeFrameFilename(f[k], origin);
    if (v) out[k] = v;
  }
  for (const k of FRAME_STRING_KEYS) {
    const v = redactText(f[k], 200);
    if (v) out[k] = v;
  }
  for (const k of ["lineno", "colno"] as const) {
    if (Number.isInteger(f[k]) && (f[k] as number) >= 0 && (f[k] as number) < 10_000_000) out[k] = f[k];
  }
  if (typeof f.in_app === "boolean") out.in_app = f.in_app;
  if (typeof f.chunk_id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(f.chunk_id)) out.chunk_id = f.chunk_id;
  // Dropped: context lines, vars, instruction addresses — source and runtime values.
  return out;
}

function sanitizeMechanism(m: unknown): Record<string, unknown> | undefined {
  if (!m || typeof m !== "object") return undefined;
  const src = m as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof src.handled === "boolean") out.handled = src.handled;
  if (typeof src.synthetic === "boolean") out.synthetic = src.synthetic;
  if (typeof src.type === "string" && /^[a-z_:.-]{1,40}$/i.test(src.type)) out.type = src.type;
  for (const k of ["exception_id", "parent_id"]) if (Number.isInteger(src[k])) out[k] = src[k];
  return out;
}

/** `$exception_list` → closed, redacted shape (null when nothing usable remains). */
export function sanitizeExceptionList(list: unknown, origin: string): Record<string, unknown>[] | null {
  if (!Array.isArray(list)) return null;
  const out: Record<string, unknown>[] = [];
  for (const item of list.slice(0, MAX_EXCEPTIONS)) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const ex: Record<string, unknown> = {};
    const type = redactText(e.type, 100);
    if (type) ex.type = type;
    const value = redactText(e.value);
    if (value) ex.value = value;
    const mechanism = sanitizeMechanism(e.mechanism);
    if (mechanism) ex.mechanism = mechanism;
    const st = e.stacktrace as { frames?: unknown; type?: unknown } | undefined;
    if (st && typeof st === "object" && Array.isArray(st.frames)) {
      const frames = st.frames
        .slice(-MAX_FRAMES)
        .map((f) => sanitizeFrame(f, origin))
        .filter((f): f is Record<string, unknown> => f !== null);
      ex.stacktrace = { type: "raw", frames };
    }
    if (ex.type || ex.value) out.push(ex);
  }
  return out.length ? out : null;
}

const LEVELS = new Set(["fatal", "error", "warning", "log", "info", "debug"]);
export function sanitizeExceptionLevel(v: unknown): string | undefined {
  return typeof v === "string" && LEVELS.has(v) ? v : undefined;
}
