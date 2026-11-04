/**
 * Shared, dependency-light validation primitives for admin-editable content.
 * Plain module (zod only, relative `.ts` imports) so it runs in the browser,
 * on the server and under `node --test`.
 */
import { z } from "zod";

/** Trimmed plain text with a maximum length (rendered as text, never HTML). */
export const text = (max: number) => z.string().trim().max(max);

/** Stable identifier for repeatable items (kept across edits / reorders). */
export const stableId = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Invalid item id");

/** Makes a fresh stable id for a new repeatable item. */
export function newStableId(prefix = "item"): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`.slice(0, 40);
}

const INTERNAL_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~/?#=&%+:@!$'()*,;]*$/;

/**
 * Safe link destination: a site-internal path ("/events?category=debate") or
 * an absolute https:// URL without credentials. Rejects javascript:, data:,
 * protocol-relative ("//evil"), backslashes, whitespace and control chars.
 */
export function isSafeHref(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v || v.length > 300 || v !== value) return false;
  if (/[\s\\\u0000-\u001f\u007f]/.test(v)) return false;
  if (v.startsWith("/")) return INTERNAL_PATH.test(v);
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    url.hostname.length > 0 &&
    url.hostname.includes(".")
  );
}

export const safeHref = z
  .string()
  .trim()
  .refine(isSafeHref, "Use a site path starting with / or an https:// link");

/** True for absolute (external) https links. */
export function isExternalHref(href: string): boolean {
  return href.startsWith("https://");
}

/** Six-digit hex colour, normalised to lowercase. */
export const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb colour")
  .transform((v) => v.toLowerCase());

/** Icons an admin may choose for homepage boxes (rendered from an allowlist). */
export const ICON_KEYS = [
  "wrench",
  "messages-square",
  "presentation",
  "file-text",
  "trophy",
  "graduation-cap",
  "stethoscope",
  "microscope",
  "heart-pulse",
  "brain",
  "pill",
  "flask-conical",
  "dna",
  "users",
  "calendar-days",
  "map-pin",
  "book-open",
  "lightbulb",
  "award",
  "info",
] as const;
export type IconKey = (typeof ICON_KEYS)[number];
export const iconKey = z.enum(ICON_KEYS);

export const ICON_LABELS: Record<IconKey, string> = {
  wrench: "Wrench (workshop)",
  "messages-square": "Speech bubbles (debate)",
  presentation: "Presentation board (poster)",
  "file-text": "Document (paper)",
  trophy: "Trophy (competition)",
  "graduation-cap": "Graduation cap (academic)",
  stethoscope: "Stethoscope",
  microscope: "Microscope",
  "heart-pulse": "Heart pulse",
  brain: "Brain",
  pill: "Pill",
  "flask-conical": "Lab flask",
  dna: "DNA",
  users: "People",
  "calendar-days": "Calendar",
  "map-pin": "Map pin",
  "book-open": "Open book",
  lightbulb: "Lightbulb",
  award: "Award",
  info: "Info",
};
