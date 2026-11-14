// Unit tests — run with `npm run test:unit` (node --test, no build step).
// 0035 / D-023: private event Google Form links reach only the paid
// payment-confirmed email.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GOOGLE_FORM_LONG_PATTERN,
  GOOGLE_FORM_SHORT_PATTERN,
  MAX_GOOGLE_FORM_URL_LENGTH,
  googleFormEmailBlock,
  parseGoogleFormUrl,
} from "./email/google-form.ts";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (f: string) => readFileSync(ROOT + f, "utf8");
const MIGRATION = "supabase/migrations/0035_open_signup_bans_event_contacts.sql";

test("only https Google Forms response links are accepted; blank clears", () => {
  for (const good of [
    "https://forms.gle/AbC123xyz",
    "https://docs.google.com/forms/d/e/1FAIpQLSc9Wx3mUq7Lr0bVQe8Tn2abc/viewform",
    "https://docs.google.com/forms/d/e/1FAIpQLSc9Wx3mUq7Lr0bVQe8Tn2abc/viewform?usp=sf_link",
    "https://docs.google.com/forms/d/1FAIpQLSc9Wx3mUq7Lr0bVQe8Tn2abc/formResponse",
  ]) {
    assert.deepEqual(parseGoogleFormUrl(`  ${good} `), { ok: true, url: good }, good);
  }
  assert.deepEqual(parseGoogleFormUrl(""), { ok: true, url: null });
  assert.deepEqual(parseGoogleFormUrl("   "), { ok: true, url: null });
  assert.deepEqual(parseGoogleFormUrl(null), { ok: true, url: null });
  for (const bad of [
    "http://forms.gle/AbC123xyz",
    "https://forms.gle.evil.test/AbC123xyz",
    "https://evil.test/https://forms.gle/AbC123xyz",
    "https://forms.gle/abc",
    "https://docs.google.com/forms/d/1FAIpQLSc9Wx3mUq7Lr0bVQe8Tn2abc/edit",
    "https://docs.google.com/forms/d/e/1FAIpQLSc9Wx3mUq7Lr0bVQe8Tn2abc/edit#responses",
    "https://docs.google.com/document/d/1FAIpQLSc9Wx3mUq7Lr0bVQe8Tn2abc/edit",
    "https://docs.google.com.evil.test/forms/d/e/1FAIpQLSc9Wx3mUq7Lr0bVQe8Tn2abc/viewform",
    'https://docs.google.com/forms/d/e/1FAIpQLSc9Wx3mUq7Lr0bVQe8Tn2abc/viewform?x="><script>',
    "javascript:alert(1)",
    "https://chat.whatsapp.com/AbCdEfGhIj1234",
  ]) {
    assert.equal(parseGoogleFormUrl(bad).ok, false, bad);
  }
  const long = "https://docs.google.com/forms/d/e/" + "a".repeat(128) + "/viewform?" + "b".repeat(255);
  assert.ok(long.length <= MAX_GOOGLE_FORM_URL_LENGTH && parseGoogleFormUrl(long).ok);
});

test("the app patterns are the database check (parity)", () => {
  const sql = read(MIGRATION);
  const sqlPatterns = [...sql.matchAll(/google_form_url ~ '(\^https:[^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(sqlPatterns, [
    GOOGLE_FORM_SHORT_PATTERN.source.replaceAll("\\/", "/"),
    GOOGLE_FORM_LONG_PATTERN.source.replaceAll("\\/", "/"),
  ]);
  assert.match(sql, /char_length\(google_form_url\) <= 500/);
  assert.equal(MAX_GOOGLE_FORM_URL_LENGTH, 500);
});

test("email block: present and escaped for a valid link, empty otherwise", () => {
  const html = googleFormEmailBlock("https://docs.google.com/forms/d/e/1FAIpQLSc9Wx3mUq7Lr0bVQe8Tn2abc/viewform?a=1&b=2");
  assert.match(html, /href="https:\/\/docs\.google\.com\/forms\/d\/e\/1FAIpQLSc9Wx3mUq7Lr0bVQe8Tn2abc\/viewform\?a=1&amp;b=2"/);
  assert.match(html, /fill in the event form/);
  assert.equal(googleFormEmailBlock(null), "");
  assert.equal(googleFormEmailBlock(""), "");
  assert.equal(googleFormEmailBlock('https://evil.test/"><img src=x>'), "");
  assert.equal(googleFormEmailBlock("https://docs.google.com/forms/d/1FAIpQLSc9Wx3mUq7Lr0bVQe8Tn2abc/edit"), "");
});

test("only the paid payment-confirmed email carries the form link", () => {
  const templates = read("lib/email/templates.ts");
  assert.equal(templates.match(/googleFormEmailBlock\(/g)?.length, 1, "one template uses it");
  const paid = templates.slice(templates.indexOf("export function paymentConfirmedEmail("));
  assert.match(paid.slice(0, paid.indexOf("\nexport ")), /googleFormEmailBlock\(googleFormUrl\)/);
  const free = templates.slice(templates.indexOf("export function registrationEmail("));
  assert.doesNotMatch(free.slice(0, free.indexOf("\nexport ")), /googleForm/i);
  const notify = read("lib/email/notify.ts");
  assert.equal(notify.match(/googleFormUrl\)/g)?.length, 1, "passed to exactly one template call");
  assert.match(notify, /: paymentConfirmedEmail\(p\.full_name, data\.event, teamName, whatsappUrl, googleFormUrl\);/);
  assert.match(notify, /registrationEmail\(p\.full_name, p\.participant_id \?\? "", data\.event, 0, teamName, whatsappUrl\)/);
});

test("the link never touches public event data", () => {
  for (const f of [
    "lib/data/events.ts",
    "types/database.ts",
    "app/(public)/events/[slug]/page.tsx",
    "components/events/event-card.tsx",
    "components/events/event-coordinators.tsx",
  ]) {
    assert.doesNotMatch(read(f), /google_form|googleForm|event_private_settings/i, f);
  }
  const sql = read(MIGRATION);
  assert.match(sql, /alter table public\.event_private_settings add column if not exists google_form_url text;/);
  assert.doesNotMatch(sql, /alter table public\.events add column[^;]*form/i);
  assert.match(sql, /revoke execute on function public\.admin_get_event_google_form_link\(uuid\) from public, anon;/);
});
