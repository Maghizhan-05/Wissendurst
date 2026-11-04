/**
 * Site appearance: validated light/dark semantic colour overrides. Only
 * allowlisted tokens with #rrggbb values are ever stored or emitted — no
 * arbitrary CSS. Absent tokens keep the design defaults from globals.css.
 */
import { z } from "zod";
import { hexColor } from "./validation.ts";

export const COLOR_TOKENS = [
  "background",
  "surface",
  "surface-2",
  "foreground",
  "muted",
  "border",
  "brand",
  "brand-2",
  "brand-contrast",
  "success",
  "warning",
  "alert",
  "ring",
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];
export type ThemeMode = "light" | "dark";

export const COLOR_TOKEN_LABELS: Record<ColorToken, { label: string; hint: string }> = {
  background: { label: "Page background", hint: "Behind everything" },
  surface: { label: "Surface", hint: "Cards and panels" },
  "surface-2": { label: "Surface (raised)", hint: "Table headers, hovers, inputs" },
  foreground: { label: "Text", hint: "Main text colour" },
  muted: { label: "Muted text", hint: "Secondary text" },
  border: { label: "Borders", hint: "Dividers and outlines" },
  brand: { label: "Brand", hint: "Primary buttons, links, highlights" },
  "brand-2": { label: "Accent", hint: "Secondary brand tone" },
  "brand-contrast": { label: "Text on brand", hint: "Text on brand-coloured buttons" },
  success: { label: "Success", hint: "Confirmed / verified states" },
  warning: { label: "Warning", hint: "Pending / coming soon" },
  alert: { label: "Alert", hint: "Errors and destructive actions" },
  ring: { label: "Focus ring", hint: "Keyboard focus outline" },
};

/** Current design defaults — must mirror app/globals.css. */
export const DEFAULT_COLORS: Record<ThemeMode, Record<ColorToken, string>> = {
  light: {
    background: "#f5fbfa",
    surface: "#ffffff",
    "surface-2": "#ecf6f4",
    foreground: "#102a2a",
    muted: "#627775",
    border: "#d5e5e2",
    brand: "#087f78",
    "brand-2": "#19afa3",
    "brand-contrast": "#ffffff",
    success: "#1e9e63",
    warning: "#b7791f",
    alert: "#d64545",
    ring: "#19afa3",
  },
  dark: {
    background: "#071a1d",
    surface: "#0b2528",
    "surface-2": "#0e2e32",
    foreground: "#f5fffd",
    muted: "#8ea9a7",
    border: "#17383c",
    brand: "#32d6c1",
    "brand-2": "#6cefe2",
    "brand-contrast": "#04211f",
    success: "#55d68a",
    warning: "#e6b450",
    alert: "#ff6b6b",
    ring: "#32d6c1",
  },
};

export type ColorOverrides = Partial<Record<ColorToken, string>>;
export interface Appearance {
  light: ColorOverrides;
  dark: ColorOverrides;
}

const overridesSchema = z
  .object(
    Object.fromEntries(COLOR_TOKENS.map((t) => [t, hexColor.optional()])) as Record<
      ColorToken,
      z.ZodOptional<typeof hexColor>
    >,
  )
  .strict();

/** Save schema: unknown modes/tokens or non-hex values are rejected. */
export const appearanceSchema = z
  .object({ light: overridesSchema, dark: overridesSchema })
  .strict();

export const EMPTY_APPEARANCE: Appearance = { light: {}, dark: {} };

/** Reads stored appearance, keeping only valid allowlisted overrides. */
export function mergeAppearance(stored: unknown): Appearance {
  const out: Appearance = { light: {}, dark: {} };
  if (typeof stored !== "object" || stored === null) return out;
  for (const mode of ["light", "dark"] as const) {
    const m = (stored as Record<string, unknown>)[mode];
    if (typeof m !== "object" || m === null) continue;
    for (const token of COLOR_TOKENS) {
      const parsed = hexColor.safeParse((m as Record<string, unknown>)[token]);
      if (parsed.success) out[mode][token] = parsed.data;
    }
  }
  return out;
}

/** Effective colours for a mode (override or design default). */
export function effectiveColors(a: Appearance, mode: ThemeMode): Record<ColorToken, string> {
  return { ...DEFAULT_COLORS[mode], ...a[mode] };
}

/**
 * CSS for the overrides only, emitted server-side in <head> before paint.
 * `html:root` / `html.dark` out-rank globals.css (:root / .dark). Values are
 * re-validated here so nothing but #rrggbb can ever reach the stylesheet.
 */
export function appearanceCss(stored: unknown): string {
  const a = mergeAppearance(stored);
  const block = (selector: string, o: ColorOverrides) => {
    const decls = COLOR_TOKENS.filter((t) => o[t] && /^#[0-9a-f]{6}$/.test(o[t]!))
      .map((t) => `--${t}:${o[t]};`)
      .join("");
    return decls ? `${selector}{${decls}}` : "";
  };
  return block("html:root", a.light) + block("html.dark", a.dark);
}

/* ── Contrast (WCAG 2.x) for editor guidance ───────────────────────────── */

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Contrast ratio between two #rrggbb colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Text/background pairs that should meet WCAG AA (4.5:1). */
export const CONTRAST_PAIRS: { fg: ColorToken; bg: ColorToken; label: string }[] = [
  { fg: "foreground", bg: "background", label: "Text on page background" },
  { fg: "foreground", bg: "surface", label: "Text on surfaces" },
  { fg: "muted", bg: "surface", label: "Muted text on surfaces" },
  { fg: "brand-contrast", bg: "brand", label: "Text on brand buttons" },
];
