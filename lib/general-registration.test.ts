// Unit tests — run with `npm run test:unit` (node --test, no build step).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canTakeGeneralRegistration,
  isGeneralRegistrationId,
  mapGrError,
  sameUpi,
  UPI_ID_PATTERN,
} from "./general-registration.ts";

test("GR ids are recognised only in the exact W27/GR/0000 form", () => {
  assert.equal(isGeneralRegistrationId("W27/GR/0001"), true);
  for (const v of ["W27/E/0001", "W27/GR/001", "w27/gr/0001", "W27/GR/00011", "", null, undefined])
    assert.equal(isGeneralRegistrationId(v), false, String(v));
});

test("only approved participants on an E id may take General Registration", () => {
  assert.equal(canTakeGeneralRegistration("W27/E/0004", "approved"), true);
  assert.equal(canTakeGeneralRegistration("W27/GR/0001", "approved"), false); // hidden after conversion
  assert.equal(canTakeGeneralRegistration("W27/E/0004", "rejected"), false);
  assert.equal(canTakeGeneralRegistration("W27/E/0004", "pending"), false);
  assert.equal(canTakeGeneralRegistration(null, "approved"), false);
});

test("UPI comparison is case- and whitespace-insensitive and never matches empties", () => {
  assert.equal(sameUpi(" Event.Pay@Bank ", "event.pay@bank"), true);
  assert.equal(sameUpi("gr@okbank", "event@okbank"), false);
  assert.equal(sameUpi("", ""), false);
  assert.equal(sameUpi(null, "x@y"), false);
});

test("UPI pattern matches the database check", () => {
  for (const ok of ["name@bank", "wd27.general@okbank", "a-b_c.d@ybl"]) assert.ok(UPI_ID_PATTERN.test(ok), ok);
  for (const bad of ["not a upi", "@bank", "name@", "name@1bank", "na me@bank", "x@bank.com"]) assert.ok(!UPI_ID_PATTERN.test(bad), bad);
});

test("RPC errors map to participant copy with a fallback", () => {
  assert.match(mapGrError('ERROR: GENERAL_REGISTRATION_CLOSED', "x"), /isn't open/);
  assert.equal(mapGrError("something else", "fallback"), "fallback");
  assert.equal(mapGrError(undefined, "fallback"), "fallback");
});
