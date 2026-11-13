/**
 * Site background images (0033): one optional image per theme, uploaded to
 * the public `site-images` bucket, plus display controls. Every value is
 * allowlisted / bounded here AND in the database (site_backgrounds_error),
 * so only these values can ever reach the generated CSS.
 */
import { z } from "zod";

export const BACKGROUND_PATH = /^backgrounds\/[A-Za-z0-9._-]{1,100}$/;
export const BACKGROUND_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const BACKGROUND_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const BACKGROUND_POSITIONS = ["top", "center", "bottom"] as const;
export const BACKGROUND_SIZES = ["cover", "contain", "auto"] as const;

export interface SiteBackgrounds {
  light: string | null;
  dark: string | null;
  /** Image opacity, percent (5–100). */
  opacity: number;
  /** Colour laid over the image to keep text readable. */
  overlay_color: string;
  /** Overlay strength, percent (0–90). */
  overlay_strength: number;
  position: (typeof BACKGROUND_POSITIONS)[number];
  size: (typeof BACKGROUND_SIZES)[number];
  repeat: boolean;
}

export const DEFAULT_BACKGROUNDS: SiteBackgrounds = {
  light: null,
  dark: null,
  opacity: 30,
  overlay_color: "#000000",
  overlay_strength: 0,
  position: "center",
  size: "cover",
  repeat: false,
};

const path = z.string().regex(BACKGROUND_PATH, "Invalid image.").nullable();
export const backgroundsSchema = z
  .object({
    light: path,
    dark: path,
    opacity: z.number().int().min(5, "Opacity must be 5–100%.").max(100, "Opacity must be 5–100%."),
    overlay_color: z.string().regex(/^#[0-9a-f]{6}$/i, "Overlay colour must be #rrggbb."),
    overlay_strength: z.number().int().min(0).max(90, "Overlay strength must be 0–90%."),
    position: z.enum(BACKGROUND_POSITIONS),
    size: z.enum(BACKGROUND_SIZES),
    repeat: z.boolean(),
  })
  .strict();

/** Stored JSON → full settings (invalid or missing values fall back to defaults). */
export function mergeBackgrounds(stored: unknown): SiteBackgrounds {
  const out: SiteBackgrounds = { ...DEFAULT_BACKGROUNDS };
  if (typeof stored !== "object" || stored === null) return out;
  const s = stored as Record<string, unknown>;
  for (const m of ["light", "dark"] as const) {
    if (typeof s[m] === "string" && BACKGROUND_PATH.test(s[m] as string)) out[m] = s[m] as string;
  }
  const int = (v: unknown, lo: number, hi: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;
  out.opacity = int(s.opacity, 5, 100) ?? out.opacity;
  out.overlay_strength = int(s.overlay_strength, 0, 90) ?? out.overlay_strength;
  if (typeof s.overlay_color === "string" && /^#[0-9a-f]{6}$/i.test(s.overlay_color)) {
    out.overlay_color = s.overlay_color.toLowerCase();
  }
  if (BACKGROUND_POSITIONS.includes(s.position as never)) out.position = s.position as SiteBackgrounds["position"];
  if (BACKGROUND_SIZES.includes(s.size as never)) out.size = s.size as SiteBackgrounds["size"];
  if (typeof s.repeat === "boolean") out.repeat = s.repeat;
  return out;
}

/** Public URL of a stored background object. */
export function backgroundUrl(supabaseUrl: string, p: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/site-images/${p}`;
}

/**
 * CSS for the fixed `.site-bg` layer (rendered once in the root layout).
 * A theme without an image keeps the original look (no rule emitted).
 */
export function backgroundsCss(stored: unknown, supabaseUrl: string | undefined): string {
  if (!supabaseUrl || !/^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/?$/.test(supabaseUrl.trim())) return "";
  const b = mergeBackgrounds(stored);
  const layer = (selector: string, img: string | null) => {
    if (!img || !BACKGROUND_PATH.test(img)) return "";
    const url = backgroundUrl(supabaseUrl.trim(), img);
    return (
      `${selector} .site-bg{display:block;background-image:url("${url}");` +
      `background-position:${b.position};background-size:${b.size};` +
      `background-repeat:${b.repeat ? "repeat" : "no-repeat"};opacity:${b.opacity / 100}}` +
      `${selector} .site-bg::after{content:"";position:absolute;inset:0;` +
      `background:${b.overlay_color};opacity:${b.overlay_strength / 100}}`
    );
  };
  return layer("html:root:not(.dark)", b.light) + layer("html.dark", b.dark);
}

/** Checks the file's leading bytes really are PNG / JPEG / WebP. */
export function sniffImageType(bytes: Uint8Array): (typeof BACKGROUND_TYPES)[number] | null {
  const at = (i: number, sig: number[]) => sig.every((v, k) => bytes[i + k] === v);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}
