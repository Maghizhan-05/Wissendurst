// Unit tests — run with `npm run test:unit` (node --test, no build step).
// Forgot-password regression: the Supabase Auth error from
// resetPasswordForEmail was discarded and the user was always told a link was
// on its way, even when Auth refused to send (rate limit, SMTP failure,
// unauthorised recipient on the built-in mailer).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { passwordResetResult, RESET_SENT_MESSAGE, RESET_FAILED_MESSAGE } from "./auth/password-reset.ts";

const ROOT = new URL("../", import.meta.url).pathname;

test("no Auth error → neutral success (no account enumeration)", () => {
  assert.deepEqual(passwordResetResult(null), { ok: true, message: RESET_SENT_MESSAGE });
  assert.match(RESET_SENT_MESSAGE, /If that email is registered/);
});

test("any Auth refusal is surfaced as a failure, never as 'link on its way'", () => {
  const refusals = [
    { status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" },
    { status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" },
    { status: 400, code: "email_address_not_authorized", message: 'Email address "x@y.z" cannot be used as it is not authorized' },
    { status: 500, code: "unexpected_failure", message: "Error sending recovery email" },
    { status: 0, code: undefined, message: "fetch failed" },
  ];
  for (const e of refusals) {
    const r = passwordResetResult(e);
    assert.equal(r.ok, false, e.message);
    assert.equal(r.ok === false && r.error, RESET_FAILED_MESSAGE, e.message);
  }
});

test("failure copy is generic: never echoes the provider message or the address", () => {
  const r = passwordResetResult({ status: 400, code: "email_address_not_authorized", message: 'Email address "victim@example.com" not authorized' });
  assert.equal(r.ok, false);
  assert.doesNotMatch(JSON.stringify(r), /victim|example\.com|authorized|rate limit/i);
  assert.match(RESET_FAILED_MESSAGE, /couldn.t send/i);
});

test("requestPasswordReset uses the resetPasswordForEmail result", () => {
  const src = readFileSync(ROOT + "lib/actions/auth.ts", "utf8");
  const start = src.indexOf("export async function requestPasswordReset(");
  const body = src.slice(start, src.indexOf("\nexport ", start + 1));
  assert.match(body, /const \{ error \} = await supabase\.auth\.resetPasswordForEmail\(/);
  assert.match(body, /return passwordResetResult\(error\);/);
  assert.doesNotMatch(body, /message: "If that email is registered/, "no unconditional success");
  // Server log carries code/status only — never the address.
  assert.doesNotMatch(body, /console\.\w+\([^)]*parsed\.data\.email/);
});
