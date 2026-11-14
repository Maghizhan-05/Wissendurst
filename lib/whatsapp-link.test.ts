// Unit tests — run with `npm run test:unit` (node --test, no build step).
// 0034: private event WhatsApp links reach only successful-registration emails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WHATSAPP_GROUP_URL_PATTERN,
  parseWhatsAppGroupUrl,
  whatsappGroupEmailBlock,
} from "./email/whatsapp.ts";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (f: string) => readFileSync(ROOT + f, "utf8");

test("only https chat.whatsapp.com invite links are accepted; blank clears", () => {
  assert.deepEqual(parseWhatsAppGroupUrl("  https://chat.whatsapp.com/AbCdEfGhIj1234 "), {
    ok: true,
    url: "https://chat.whatsapp.com/AbCdEfGhIj1234",
  });
  assert.deepEqual(parseWhatsAppGroupUrl("https://chat.whatsapp.com/AbCdEfGhIj1234?mode=r_c"), {
    ok: true,
    url: "https://chat.whatsapp.com/AbCdEfGhIj1234?mode=r_c",
  });
  assert.deepEqual(parseWhatsAppGroupUrl(""), { ok: true, url: null });
  assert.deepEqual(parseWhatsAppGroupUrl(null), { ok: true, url: null });
  for (const bad of [
    "http://chat.whatsapp.com/AbCdEfGhIj1234",
    "https://chat.whatsapp.com.evil.test/AbCdEfGhIj1234",
    "https://evil.test/https://chat.whatsapp.com/AbCdEfGhIj1234",
    "https://chat.whatsapp.com/short",
    'https://chat.whatsapp.com/AbCdEfGhIj1234"><script>',
    "javascript:alert(1)",
    "https://wa.me/919999999999",
  ]) {
    assert.equal(parseWhatsAppGroupUrl(bad).ok, false, bad);
  }
});

test("the app pattern is the database check", () => {
  const sql = read("supabase/migrations/0034_event_admins_private_links.sql");
  const sqlPatterns = [...sql.matchAll(/~ '(\^https:[^']+)'/g)].map((m) => m[1]);
  assert.equal(sqlPatterns.length, 2, "table check and RPC check");
  for (const p of sqlPatterns) {
    // SQL regex source vs. JS regex source (JS escapes "/").
    assert.equal(p, WHATSAPP_GROUP_URL_PATTERN.source.replaceAll("\\/", "/"));
  }
});

test("email block: present for a valid link, empty otherwise", () => {
  const html = whatsappGroupEmailBlock("https://chat.whatsapp.com/AbCdEfGhIj1234?mode=r_c&x=1");
  assert.match(html, /href="https:\/\/chat\.whatsapp\.com\/AbCdEfGhIj1234\?mode=r_c&amp;x=1"/);
  assert.match(html, /Join the event WhatsApp group/);
  assert.equal(whatsappGroupEmailBlock(null), "");
  assert.equal(whatsappGroupEmailBlock(""), "");
  assert.equal(whatsappGroupEmailBlock('https://evil.test/"><img src=x>'), "");
});

test("only the successful-registration emails can carry the link", () => {
  const templates = read("lib/email/templates.ts");
  // registrationEmail: only on its no-payment-due (confirmed) branch;
  // paymentConfirmedEmail: always (sent only once verified).
  assert.equal(templates.match(/whatsappGroupEmailBlock\(/g)?.length, 2);
  assert.match(templates, /\$\{paid \? whatsappGroupEmailBlock\(whatsappUrl\) : ""\}/);
  const notify = read("lib/email/notify.ts");
  assert.equal(notify.match(/loadEventPrivateLinks\(/g)?.length, 2, "defined once, used once (0035 rename)");
  const confirmed = notify.slice(notify.indexOf("export async function notifyRegistrationConfirmed("));
  const body = confirmed.slice(0, confirmed.indexOf("\nexport "));
  assert.match(body, /loadEventPrivateLinks\(data\.event\.id\)/);
  assert.match(body, /registration_status !== "confirmed"\) return;/);
});

test("the link never touches public event data", () => {
  for (const f of [
    "lib/data/events.ts",
    "types/database.ts",
    "app/(public)/events/[slug]/page.tsx",
    "components/events/event-card.tsx",
  ]) {
    assert.doesNotMatch(read(f), /whatsapp|event_private_settings/i, f);
  }
  const sql = read("supabase/migrations/0034_event_admins_private_links.sql");
  assert.match(sql, /revoke all on public\.event_private_settings from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /alter table public\.events add column/i);
});
