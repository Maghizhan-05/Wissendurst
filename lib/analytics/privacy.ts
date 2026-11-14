/**
 * Replay/autocapture privacy markers and masking functions (D-024). Pure.
 *
 * Markers (use on elements, never on inputs):
 *  - `ph-no-capture` (class): PostHog's own marker. The element and its
 *    subtree are excluded from autocapture and BLOCKED in session replay
 *    (rendered as an empty placeholder). Use for anything identity-bearing,
 *    contact details, uploaded/user images, QR codes and payment panels.
 *  - `data-ph-unmask` (attribute): reviewed, static public copy whose text
 *    may appear in replay. All other text is masked. Inputs are always
 *    masked (no exception).
 */

export const NO_CAPTURE_CLASS = "ph-no-capture";
export const UNMASK_ATTR = "data-ph-unmask";

/** Blocked in replay in addition to `.ph-no-capture`. */
export const REPLAY_BLOCK_SELECTOR = [
  "img",
  "picture",
  "video",
  "audio",
  "canvas",
  "iframe",
  "object",
  "embed",
  "svg image",
  "[data-qr]",
  `.${NO_CAPTURE_CLASS}`,
].join(", ");

/** Excluded from autocapture (with PostHog's built-in `.ph-no-capture`). */
export const AUTOCAPTURE_IGNORE_SELECTORS = [`.${NO_CAPTURE_CLASS}`, "[data-qr]", "img", "canvas", "video"];

interface ClosestCapable {
  closest?: (selector: string) => unknown;
  parentElement?: ClosestCapable | null;
}

/** Text is shown only inside a reviewed `data-ph-unmask` region, never inside a blocked one. */
export function replayTextAllowed(element: ClosestCapable | null | undefined): boolean {
  if (!element || typeof element.closest !== "function") return false;
  if (element.closest(`.${NO_CAPTURE_CLASS}, [data-qr], input, textarea, select, [contenteditable]`)) return false;
  return Boolean(element.closest(`[${UNMASK_ATTR}]`));
}

/** rrweb maskTextFn: keep reviewed static copy, mask everything else (length kept). */
export function maskReplayText(text: string, element?: ClosestCapable | null): string {
  return replayTextAllowed(element) ? text : text.replace(/\S/g, "*");
}

/** Inputs: always masked, no exception. */
export function maskReplayInput(text: string): string {
  return "*".repeat(Math.min(text.length, 12));
}

const TEXT_ATTRS = new Set([
  "alt",
  "title",
  "placeholder",
  "value",
  "label",
  "content",
  "aria-label",
  "aria-description",
  "aria-valuetext",
  "aria-placeholder",
  "data-tooltip",
]);
const URL_ATTRS = new Set(["href", "src", "srcset", "action", "formaction", "poster", "xlink:href", "data-src", "cite"]);

/**
 * rrweb maskAttributeFn: URL attributes → same-origin pathname only (or
 * dropped); text-bearing and data-* attributes → masked; layout attributes
 * (class, style, role, type, sizes…) unchanged.
 */
export function maskReplayAttribute(name: string, value: string, origin: string): string {
  const n = name.toLowerCase();
  if (URL_ATTRS.has(n)) {
    if (n === "srcset") return "";
    try {
      const u = new URL(value, origin);
      if (u.origin !== origin) return "";
      return u.pathname;
    } catch {
      return "";
    }
  }
  if (TEXT_ATTRS.has(n) || (n.startsWith("data-") && !n.startsWith("data-ph-") && n !== "data-state" && n !== "data-slot")) {
    return value.replace(/\S/g, "*");
  }
  return value;
}
