// Unit tests — run with `npm run test:unit` (node --test, no build step).
// D-029: participants can withdraw a genuinely unpaid registration (solo, or a
// team head for the whole team); teammates are pointed to their head; the
// teammate lookup accepts an eligible solo intent (absorbed by the RPC).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withdrawalKind, WITHDRAW_COPY, TEAM_MEMBER_WITHDRAW_GUIDANCE } from "./registration-withdrawal.ts";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (f: string) => readFileSync(ROOT + f, "utf8");
function fnBody(file: string, name: string): string {
  const src = read(file);
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} not found in ${file}`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

const unpaid = {
  team_id: null as string | null,
  is_team_head: false,
  registration_status: "pending",
  payment_status: "unpaid",
  payment_screenshot: null as string | null,
  transaction_id: null as string | null,
  duplicate_of: null as string | null,
};

test("withdrawal eligibility mirrors cancel_my_registration", () => {
  assert.equal(withdrawalKind(unpaid), "solo");
  assert.equal(withdrawalKind({ ...unpaid, team_id: "t", is_team_head: true }), "team_head");
  assert.equal(withdrawalKind({ ...unpaid, team_id: "t", is_team_head: true }, 1), "solo", "a team of one reads as solo");
  assert.equal(withdrawalKind({ ...unpaid, team_id: "t", is_team_head: true }, 3), "team_head");
  assert.equal(withdrawalKind({ ...unpaid, team_id: "t", is_team_head: false }), "team_member");
  for (const bad of [
    { registration_status: "confirmed", payment_status: "verified" },
    { registration_status: "cancelled" },
    { registration_status: "rejected", payment_status: "rejected" },
    { payment_status: "uploaded" },
    { payment_status: "under_review" },
    { payment_status: "duplicate" },
    { payment_screenshot: "p/x.png" },
    { transaction_id: "UTR1" },
    { duplicate_of: "r" },
  ]) {
    assert.equal(withdrawalKind({ ...unpaid, ...bad }), null, JSON.stringify(bad));
    assert.equal(withdrawalKind({ ...unpaid, team_id: "t", is_team_head: true, ...bad }), null, JSON.stringify(bad));
  }
  // A teammate on a team that has paid is still just a teammate (no control either way).
  assert.equal(withdrawalKind({ ...unpaid, team_id: "t", is_team_head: false, payment_status: "uploaded" }), "team_member");
});

test("confirmation copy: solo releases the seat; team head cancels the ENTIRE team", () => {
  assert.match(WITHDRAW_COPY.solo.body, /seat is released/);
  assert.doesNotMatch(WITHDRAW_COPY.solo.body, /team/i);
  assert.match(WITHDRAW_COPY.team_head.title, /entire team/i);
  assert.match(WITHDRAW_COPY.team_head.body, /entire team/i);
  assert.match(WITHDRAW_COPY.team_head.body, /every teammate/i);
  assert.match(WITHDRAW_COPY.team_head.confirm, /entire team/i);
  assert.match(TEAM_MEMBER_WITHDRAW_GUIDANCE, /team head/);
});

test("withdrawRegistration wraps cancel_my_registration and re-opens the event", () => {
  const body = fnBody("lib/actions/registration.ts", "withdrawRegistration");
  assert.match(body, /supabase\.rpc\("cancel_my_registration", \{\s*p_registration_id: id,?\s*\}\)/);
  assert.match(body, /revalidatePath\(`\/events\/\$\{slug\}`\)/);
  assert.match(body, /revalidatePath\("\/dashboard\/registrations"\)/);
  assert.match(body, /next: slug \? `\/events\/\$\{encodeURIComponent\(slug\)\}` : "\/events"/);
  const src = read("lib/actions/registration.ts");
  assert.doesNotMatch(src, /rpc\("cancel_registration"/, "the revoked legacy RPC is not called");
  assert.match(src, /NOT_TEAM_HEAD: "[^"]*team head[^"]*"/);
  assert.match(src, /NOT_CANCELLABLE:\s+"[^"]+"/);
  assert.doesNotMatch(body, /sendMail|notify/i, "no cancellation email");
});

test("teammate lookup uses the absorption-aware predicate (registration_blocks_new unchanged)", () => {
  const body = fnBody("lib/actions/registration.ts", "lookupTeamMember");
  assert.match(body, /admin\.rpc\("registration_blocks_team_add", \{\s*p_profile_id: p\.id,\s*p_event_id: eventId,\s*p_exclude_team_id: excludeTeamId,\s*\}\)/);
  assert.doesNotMatch(body, /registration_blocks_new/);
});

test("event page CTA: withdraw only for solo/team head; teammates get guidance", () => {
  const cta = read("components/events/register-cta.tsx");
  assert.match(cta, /const withdrawKind = withdrawalKind\(existing\);/);
  assert.match(cta, /\(withdrawKind === "solo" \|\| withdrawKind === "team_head"\) && \(\s*<WithdrawRegistration/);
  assert.match(cta, /\{TEAM_MEMBER_WITHDRAW_GUIDANCE\}/);
});

test("payment page: withdraw only for solo/team head; teammate block names the head", () => {
  const page = read("app/dashboard/payment/[id]/page.tsx");
  assert.match(page, /const withdrawKind = withdrawalKind\(registration, team\?\.members\.length\);/);
  assert.match(page, /\(withdrawKind === "solo" \|\| withdrawKind === "team_head"\) && \(/);
  assert.match(page, /TEAM_MEMBER_WITHDRAW_GUIDANCE/);
});

test("withdraw control confirms before calling the action", () => {
  const c = read("components/registration/withdraw-registration.tsx");
  assert.match(c, /^"use client";/);
  assert.match(c, /useActionState\(withdrawRegistration, null\)/);
  assert.match(c, /const copy = WITHDRAW_COPY\[kind\];/);
  assert.match(c, /\{confirming \? \(/, "a confirmation step precedes the submit");
  assert.match(c, /name="registration_id"/);
});
