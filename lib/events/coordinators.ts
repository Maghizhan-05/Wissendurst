/**
 * Public event coordinators (0035 / D-023). Stored on events.coordinators as a
 * JSON array; the database re-checks every rule (event_coordinators_error).
 * Pure (no imports) so server actions, the editor and tests share it.
 */

export const MAX_COORDINATORS = 10;
export const MAX_COORDINATOR_NAME = 80;
export const MAX_COORDINATOR_ROLE = 80;
export const MAX_COORDINATOR_EMAIL = 254;
/** Same as the database: digits, spaces and hyphens, optional leading +, 7–20 chars. */
export const COORDINATOR_PHONE_PATTERN = /^\+?[0-9][0-9 -]{5,18}[0-9]$/;
export const COORDINATOR_EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export interface EventCoordinator {
  name: string;
  role?: string;
  phone?: string;
  email?: string;
}

/** Raw editor row (every field a string; blanks allowed while editing). */
export interface CoordinatorDraft {
  name: string;
  role: string;
  phone: string;
  email: string;
}

export type CoordinatorFieldErrors = Partial<Record<"name" | "role" | "phone" | "email" | "contact", string>>;

export type CoordinatorsResult =
  | { ok: true; coordinators: EventCoordinator[] }
  | { ok: false; error: string; rowErrors: CoordinatorFieldErrors[] };

const CONTROL = /[\u0000-\u001f\u007f]/;

/** Collapses inner whitespace runs; trims. */
function clean(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

/** Validates editor rows into the stored shape (blank optional fields omitted). */
export function validateCoordinators(rows: readonly Partial<CoordinatorDraft>[]): CoordinatorsResult {
  const rowErrors: CoordinatorFieldErrors[] = [];
  const coordinators: EventCoordinator[] = [];
  if (rows.length > MAX_COORDINATORS) {
    return { ok: false, error: `Add at most ${MAX_COORDINATORS} coordinators.`, rowErrors: [] };
  }
  rows.forEach((row, i) => {
    const name = clean(row.name);
    const role = clean(row.role);
    const phone = clean(row.phone);
    const email = clean(row.email);
    const e: CoordinatorFieldErrors = {};
    if (!name) e.name = "Enter the coordinator's name.";
    else if (name.length > MAX_COORDINATOR_NAME) e.name = `Keep the name under ${MAX_COORDINATOR_NAME} characters.`;
    if (role.length > MAX_COORDINATOR_ROLE) e.role = `Keep the role under ${MAX_COORDINATOR_ROLE} characters.`;
    if (phone && !COORDINATOR_PHONE_PATTERN.test(phone))
      e.phone = "Use digits, spaces or hyphens, with an optional leading + (7–20 characters).";
    if (email && (email.length > MAX_COORDINATOR_EMAIL || !COORDINATOR_EMAIL_PATTERN.test(email)))
      e.email = "Enter a valid email address, like name@college.edu.";
    if (!phone && !email) e.contact = "Add a phone number or an email (or both).";
    for (const v of [name, role, phone, email]) if (CONTROL.test(v)) e.name = e.name ?? "Remove special characters.";
    rowErrors[i] = e;
    const c: EventCoordinator = { name };
    if (role) c.role = role;
    if (phone) c.phone = phone;
    if (email) c.email = email;
    coordinators.push(c);
  });
  const bad = rowErrors.findIndex((e) => Object.keys(e).length > 0);
  if (bad >= 0) {
    const first = rowErrors[bad];
    const msg = first.name ?? first.contact ?? first.phone ?? first.email ?? first.role ?? "Check the coordinators.";
    return { ok: false, error: `Coordinator ${bad + 1}: ${msg}`, rowErrors };
  }
  return { ok: true, coordinators };
}

/** Parses the editor's hidden JSON field. */
export function parseCoordinatorsField(raw: unknown): CoordinatorsResult {
  if (raw == null || raw === "") return { ok: true, coordinators: [] };
  let v: unknown;
  try {
    v = JSON.parse(String(raw));
  } catch {
    return { ok: false, error: "Coordinators couldn't be read. Reload and try again.", rowErrors: [] };
  }
  if (!Array.isArray(v)) return { ok: false, error: "Check the coordinators.", rowErrors: [] };
  return validateCoordinators(v as Partial<CoordinatorDraft>[]);
}

/** Stored value (any shape) → displayable coordinators; invalid entries dropped. */
export function normalizeStoredCoordinators(value: unknown): EventCoordinator[] {
  if (!Array.isArray(value)) return [];
  const out: EventCoordinator[] = [];
  for (const item of value.slice(0, MAX_COORDINATORS)) {
    if (!item || typeof item !== "object") continue;
    const r = validateCoordinators([item as Partial<CoordinatorDraft>]);
    if (r.ok) out.push(r.coordinators[0]);
  }
  return out;
}

/** Stored coordinators → editor rows. */
export function coordinatorsToDrafts(value: unknown): CoordinatorDraft[] {
  return normalizeStoredCoordinators(value).map((c) => ({
    name: c.name,
    role: c.role ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
  }));
}

/** tel: target — digits and a leading + only. */
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return `tel:${digits.startsWith("+") ? "+" + digits.slice(1).replace(/\+/g, "") : digits.replace(/\+/g, "")}`;
}

/** mailto: target for an already-validated address. */
export function mailHref(email: string): string {
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}`;
}
