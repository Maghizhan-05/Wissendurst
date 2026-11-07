// Unit tests — run with `npm run test:unit` (node --test, no build step).
// Regression guard (D-019): registration surfaces list CONFIRMED rows only —
// free registrations, or payment verified. Payment intents, submissions under
// review and rejected payments must never appear in the participant's history,
// Admin Registrations, the per-user list or the participant export.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url).pathname;

/** Body of `export async function <name>` up to the next top-level export. */
function fnBody(file: string, name: string): string {
  const src = readFileSync(ROOT + file, "utf8");
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} not found in ${file}`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

const CONFIRMED = /\.eq\(\s*"registration_status",\s*"confirmed"\s*\)/;

for (const [file, fn] of [
  ["lib/data/registrations.ts", "getMyRegistrations"],
  ["lib/data/admin.ts", "getRegistrationsAdmin"],
  ["lib/data/admin.ts", "getUserWithRegistrations"],
  ["app/admin/events/[id]/export/route.ts", "GET"],
] as const) {
  test(`${fn} lists confirmed registrations only`, () => {
    assert.match(fnBody(file, fn), CONFIRMED);
  });
}

test("Admin Registrations offers no payment/registration-status filters", () => {
  const page = readFileSync(ROOT + "app/admin/registrations/page.tsx", "utf8");
  assert.doesNotMatch(page, /name="payment"|name="registration"|name="duplicates"/);
});

test("participant dashboard shows no unpaid totals", () => {
  const page = readFileSync(ROOT + "app/dashboard/page.tsx", "utf8");
  assert.doesNotMatch(page, /Amount due|Awaiting payment|unpaid registrations/);
});
