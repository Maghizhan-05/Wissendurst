// Unit tests — run with `npm run test:unit` (node --test, no build step).
// Admin ID-card visibility (regression from Restructuring 4/4, which retired
// the approval page — the only place submitted ID cards were shown).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

test("signed ID-card URLs stay Users-scope only and short-lived", () => {
  const actions = read("lib/actions/admin.ts");
  assert.match(
    actions,
    /export async function getIdCardSignedUrl\(path: string\): Promise<string \| null> \{\n\s+await requireScope\("signups"\);[\s\S]*?\.from\(BUCKETS\.idCards\)\n\s+\.createSignedUrl\(path, 60 \* 10\);/,
  );
});

test("user details show the submitted ID card", () => {
  const page = read("app/admin/users/[id]/page.tsx");
  assert.match(page, /const viewer = await requireScope\("signups"\);/);
  assert.match(page, /profile\.id_card_path \? await getIdCardSignedUrl\(profile\.id_card_path\) : null/);
  assert.match(page, /<IdCardImage url=\{idCardUrl\} hasCard=\{Boolean\(profile\.id_card_path\)\}/);
  assert.match(page, />\s*College ID card\s*</);
});

test("registration detail shows ID cards only to Users-scope viewers, after the event check", () => {
  const page = read("app/admin/registrations/[id]/page.tsx");
  const guard = page.indexOf('if (!reg || !canOnEvent(access, reg.eventId, "events")) notFound();');
  const sign = page.indexOf("getIdCardSignedUrl(p.idCardPath)");
  assert.ok(guard > 0 && sign > guard, "event permission is checked before any URL is signed");
  assert.match(page, /const canSeeUsers = hasGlobalScope\(access, "signups"\);\n\s+const idCards = canSeeUsers\n\s+\? await Promise\.all/);
  assert.match(page, /idCard=\{idCards \? \{ url: idCards\[i\] \} : null\}/);
  assert.match(page, /\{idCard && \(/, "no ID card block for per-event admins");
  // The storage path is never printed.
  assert.doesNotMatch(page, /\{p\.idCardPath\}/);
  const data = read("lib/data/event-admin.ts");
  assert.match(data, /profile:profiles!profile_id\(id,id_card_path,participant_id,/);
});

test("ID card component renders a signed URL or a clear empty state", () => {
  const c = read("components/admin/id-card-image.tsx");
  assert.doesNotMatch(c, /^"use client"/m);
  assert.match(c, /No ID card uploaded/);
  assert.match(c, /rel="noopener noreferrer"/);
  assert.match(c, /referrerPolicy="no-referrer"/);
});
