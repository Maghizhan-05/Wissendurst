// Unit tests — run with `npm run test:unit` (node --test, no build step).
// D-024: consent cookie, versioning, serialization and browser-signal precedence.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  browserSignalDenial,
  consentCookieValue,
  effectiveConsent,
  headersSignalDenial,
  parseConsentValue,
  readConsentFromCookieString,
  serializeConsentCookie,
} from "./analytics/consent.ts";
import { parseProjectToken, POSTHOG_API_HOST } from "./analytics/config.ts";

test("versioned values parse; anything else is unknown", () => {
  assert.equal(parseConsentValue("v1.granted"), "granted");
  assert.equal(parseConsentValue("v1.denied"), "denied");
  for (const bad of [undefined, null, "", "granted", "v2.granted", "v0.denied", "v1.yes", "v1.granted;x", "V1.granted"]) {
    assert.equal(parseConsentValue(bad as string), "unknown", String(bad));
  }
  assert.equal(consentCookieValue("granted"), "v1.granted");
});

test("reads the decision from a cookie string", () => {
  assert.equal(readConsentFromCookieString(`a=1; ${CONSENT_COOKIE}=v1.granted; b=2`), "granted");
  assert.equal(readConsentFromCookieString(`${CONSENT_COOKIE}=v1.denied`), "denied");
  assert.equal(readConsentFromCookieString(`x${CONSENT_COOKIE}=v1.granted`), "unknown");
  assert.equal(readConsentFromCookieString(`${CONSENT_COOKIE}=%E0%A4%A`), "unknown");
  assert.equal(readConsentFromCookieString(""), "unknown");
  assert.equal(readConsentFromCookieString(null), "unknown");
});

test("cookie: one year, Path=/, SameSite=Lax, Secure only when requested", () => {
  assert.equal(
    serializeConsentCookie("granted", { secure: true }),
    `${CONSENT_COOKIE}=v1.granted; Max-Age=31536000; Path=/; SameSite=Lax; Secure`,
  );
  assert.equal(
    serializeConsentCookie("denied", { secure: false }),
    `${CONSENT_COOKIE}=v1.denied; Max-Age=31536000; Path=/; SameSite=Lax`,
  );
  assert.equal(CONSENT_MAX_AGE_SECONDS, 365 * 24 * 3600);
});

test("GPC / DNT are an absolute denial that the stored choice cannot override", () => {
  assert.deepEqual(effectiveConsent("granted", true), { state: "denied", reason: "browser-signal" });
  assert.deepEqual(effectiveConsent("unknown", true), { state: "denied", reason: "browser-signal" });
  assert.deepEqual(effectiveConsent("granted", false), { state: "granted" });
  assert.deepEqual(effectiveConsent("denied", false), { state: "denied", reason: "choice" });
  assert.deepEqual(effectiveConsent("unknown", false), { state: "unknown" });

  const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
  assert.equal(headersSignalDenial(h({ "sec-gpc": "1" })), true);
  assert.equal(headersSignalDenial(h({ dnt: "1" })), true);
  assert.equal(headersSignalDenial(h({ dnt: "0", "sec-gpc": "0" })), false);
  assert.equal(headersSignalDenial(h({})), false);

  assert.equal(browserSignalDenial({ globalPrivacyControl: true }), true);
  assert.equal(browserSignalDenial({ doNotTrack: "1" }), true);
  assert.equal(browserSignalDenial({}, { doNotTrack: "1" }), true);
  assert.equal(browserSignalDenial({ globalPrivacyControl: false, doNotTrack: "unspecified" }), false);
  assert.equal(browserSignalDenial(undefined), false);
});

test("the signal is never written to the cookie", () => {
  for (const choice of ["granted", "denied"] as const) {
    assert.doesNotMatch(serializeConsentCookie(choice, { secure: true }), /gpc|dnt|signal/i);
  }
});

test("only a well-formed public project token enables analytics; host is EU", () => {
  assert.equal(POSTHOG_API_HOST, "https://eu.i.posthog.com");
  assert.equal(parseProjectToken(undefined), null);
  assert.equal(parseProjectToken(""), null);
  assert.equal(parseProjectToken("   "), null);
  assert.equal(parseProjectToken("phx_personalApiKeyNotAllowed1234567890"), null);
  assert.equal(parseProjectToken("phc_short"), null);
  assert.equal(parseProjectToken("phc_abc def ghi jkl mno pqr"), null);
  const token = "phc_" + "A1b2C3d4".repeat(5);
  assert.equal(parseProjectToken(` ${token} `), token);
});
