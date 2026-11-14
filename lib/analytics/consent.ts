/**
 * Analytics consent (D-024). Pure — shared by the server layout, the client
 * provider and tests.
 *
 * The decision lives in one versioned first-party cookie for a year. A
 * browser privacy signal (Global Privacy Control / Do Not Track) is an
 * absolute denial that no click can override; it is evaluated live and is
 * never written into the cookie.
 */

export const CONSENT_COOKIE = "wd_analytics_consent";
export const CONSENT_VERSION = 1;
export const CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export type StoredConsent = "unknown" | "granted" | "denied";
export type ConsentChoice = Exclude<StoredConsent, "unknown">;

/** Why analytics is (not) allowed right now. */
export type EffectiveConsent =
  | { state: "granted" }
  | { state: "denied"; reason: "choice" | "browser-signal" }
  | { state: "unknown" };

const VALUE_PATTERN = /^v(\d+)\.(granted|denied)$/;

/** Cookie value → stored decision. Any other version or shape is "unknown". */
export function parseConsentValue(value: string | null | undefined): StoredConsent {
  if (typeof value !== "string") return "unknown";
  const m = VALUE_PATTERN.exec(value.trim());
  if (!m || Number(m[1]) !== CONSENT_VERSION) return "unknown";
  return m[2] as ConsentChoice;
}

/** Reads the decision from a `Cookie` header / `document.cookie` string. */
export function readConsentFromCookieString(cookieString: string | null | undefined): StoredConsent {
  if (!cookieString) return "unknown";
  for (const part of cookieString.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === CONSENT_COOKIE) {
      let raw = part.slice(eq + 1).trim();
      try {
        raw = decodeURIComponent(raw);
      } catch {
        return "unknown";
      }
      return parseConsentValue(raw);
    }
  }
  return "unknown";
}

export function consentCookieValue(choice: ConsentChoice): string {
  return `v${CONSENT_VERSION}.${choice}`;
}

/** `document.cookie` assignment for a decision (one year, Path=/, Lax, Secure in production). */
export function serializeConsentCookie(choice: ConsentChoice, opts: { secure: boolean }): string {
  return [
    `${CONSENT_COOKIE}=${consentCookieValue(choice)}`,
    `Max-Age=${CONSENT_MAX_AGE_SECONDS}`,
    "Path=/",
    "SameSite=Lax",
    ...(opts.secure ? ["Secure"] : []),
  ].join("; ");
}

/** Request headers: `Sec-GPC: 1` or `DNT: 1`. */
export function headersSignalDenial(get: (name: string) => string | null | undefined): boolean {
  return (get("sec-gpc") ?? "").trim() === "1" || (get("dnt") ?? "").trim() === "1";
}

/** The live browser signal (navigator.globalPrivacyControl / doNotTrack). */
export function browserSignalDenial(
  nav: { globalPrivacyControl?: unknown; doNotTrack?: unknown } | undefined,
  win?: { doNotTrack?: unknown } | undefined,
): boolean {
  if (!nav && !win) return false;
  return (
    nav?.globalPrivacyControl === true ||
    nav?.doNotTrack === "1" ||
    nav?.doNotTrack === "yes" ||
    win?.doNotTrack === "1"
  );
}

/** The signal always wins; otherwise the stored decision applies. */
export function effectiveConsent(stored: StoredConsent, signalDenial: boolean): EffectiveConsent {
  if (signalDenial) return { state: "denied", reason: "browser-signal" };
  if (stored === "granted") return { state: "granted" };
  if (stored === "denied") return { state: "denied", reason: "choice" };
  return { state: "unknown" };
}
