// Unit tests — run with `npm run test:unit` (node --test, no build step).
// D-022 regression guards: aggregate registration figures count registration
// units through the shared helper, while capacity, rosters/exports, per-user
// history, payment queues and General Registration stay per participant; and
// public Event Rules render as authored paragraphs without numbering.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (f: string) => readFileSync(ROOT + f, "utf8");

function fnBody(file: string, name: string): string {
  const src = read(file);
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} not found in ${file}`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

test("Admin Overview counts every registration figure in units", () => {
  const body = fnBody("lib/data/admin.ts", "getAdminStats");
  assert.match(body, /registrations: countRegistrationUnits\(confirmed\)/);
  for (const status of ["verified", "under_review", "duplicate"]) {
    assert.match(body, new RegExp(`byPayment\\("${status}"\\)`));
  }
  assert.match(body, /count: countRegistrationUnits\(list\)/, "per-event units");
  // the old per-row head counts are gone
  assert.doesNotMatch(read("lib/data/admin.ts"), /count: "exact", head: true \}\);\s*if \(filter/);
  // revenue is still a per-row money sum
  assert.match(body, /\.select\("amount"\)\s*\.eq\("payment_status", "verified"\)/);
});

test("Collections figures are unit sets; money stays per row", () => {
  const src = read("lib/data/collections.ts");
  assert.match(src, /import \{ registrationUnitKey, type UnitRow \} from "@\/lib\/registration-groups"/);
  assert.match(src, /total: units\(confirmed\)/);
  assert.match(src, /verified: units\(verified\)/);
  assert.match(src, /pending: units\(intents\)/);
  assert.match(src, /const collected = verified\.reduce\(\(s, r\) => s \+ \(r\.amount \?\? 0\), 0\)/);
});

test("participant-oriented surfaces do not use registration units", () => {
  for (const f of [
    "lib/data/events.ts", // capacity / spots left
    "app/(public)/events/[slug]/page.tsx",
    "app/admin/events/[id]/export/route.ts", // exports
    "lib/data/registrations.ts", // per-user history
    "app/dashboard/page.tsx",
    "app/admin/payments/page.tsx", // payment queues
    "lib/data/general-registration.ts",
    "app/admin/general-registration/page.tsx",
  ]) {
    assert.doesNotMatch(read(f), /countRegistrationUnits|registrationUnitKey/, f);
  }
});

test("one shared classification: groupRegistrations uses isTeamUnitRow", () => {
  const src = read("lib/registration-groups.ts");
  assert.match(src, /if \(isTeamUnitRow\(r\)\)/);
  assert.match(src, /return isTeamUnitRow\(r\) \? `team:\$\{r\.team_id\}` : `reg:\$\{r\.id\}`/);
});

test("public Event Rules: authored paragraphs, no generated numbering, hidden when empty", () => {
  const page = read("app/(public)/events/[slug]/page.tsx");
  assert.match(page, /const rules = normalizeStoredRules\(event\.rules\)/);
  assert.match(page, /\{rules\.length > 0 && \(/);
  assert.match(page, /whitespace-pre-line/);
  assert.doesNotMatch(page, /padStart\(2, "0"\)/);
  assert.doesNotMatch(page, /event\.rules\.map/);
});

test("both editors parse rules as paragraphs and show the guidance", () => {
  const actions = read("lib/actions/admin.ts");
  assert.match(actions, /const rules = parseRulesText\(input\.rules\)/);
  assert.doesNotMatch(actions, /\.split\("\\n"\)\s*\.map\(\(r\) => r\.trim\(\)\)/);
  for (const f of ["components/admin/event-form.tsx", "components/admin/event-details-form.tsx"]) {
    const src = read(f);
    assert.match(src, /hint=\{RULES_HINT\}/, f);
    assert.match(src, /rulesToEditorText\(event\??\.rules\)/, f);
    assert.doesNotMatch(src, /One rule per line/, f);
  }
  assert.match(read("components/admin/rules-guidance.ts"), /blank line between paragraphs[\s\S]*no numbers are added/);
});

test("event-administrator loaders list confirmed registrations only", () => {
  const CONFIRMED = /\.eq\(\s*"registration_status",\s*"confirmed"\s*\)/;
  assert.match(fnBody("lib/data/event-admin.ts", "getRegistrationsForEvents"), CONFIRMED);
  assert.match(fnBody("lib/data/event-admin.ts", "getRegistrationContact"), CONFIRMED);
});

test("contact detail carries no payment evidence", () => {
  const src = read("lib/data/event-admin.ts");
  const contactSelect = src.match(/const CONTACT_SELECT =\s*"([^"]+)"/)?.[1] ?? "";
  const rosterSelect = src.match(/const ROSTER_SELECT =\s*"([^"]+)"/)?.[1] ?? "";
  for (const sel of [contactSelect, rosterSelect]) {
    assert.ok(sel.length > 0);
    assert.doesNotMatch(sel, /transaction_id|payment_screenshot|ocr_|amount|\*/);
  }
  const page = read("app/admin/registrations/[id]/page.tsx");
  assert.doesNotMatch(page, /transaction_id|payment_screenshot|ScreenshotSignedUrl|formatINR/);
  assert.match(page, /if \(!reg \|\| !canOnEvent\(access, reg\.eventId, "events"\)\) notFound\(\);/);
});
