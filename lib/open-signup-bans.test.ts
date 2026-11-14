// Unit tests — run with `npm run test:unit` (node --test, no build step).
// 0035: approval-free sign-up routing and evidence-preserving bans (app layer;
// database behaviour is covered by supabase/tests/0035_*).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (f: string) => readFileSync(ROOT + f, "utf8");

test("sign-up activates through the server RPC and never parks users on pending approval", () => {
  const auth = read("lib/actions/auth.ts");
  assert.match(auth, /admin\.rpc\("server_complete_signup"/);
  assert.doesNotMatch(auth, /notifySignupPending|awaiting approval|pending organizer approval/i);
  assert.doesNotMatch(read("lib/auth.ts"), /redirect\("\/pending-approval"\)/);
  for (const f of ["lib/email/notify.ts", "lib/email/templates.ts", "lib/actions/admin.ts", "lib/data/admin.ts"]) {
    assert.doesNotMatch(read(f), /notifySignupPending|signupPendingEmail|approvalGrantedEmail|admin_set_approval|getPendingSignups|countPendingSignups/, f);
  }
  assert.equal(existsSync(ROOT + "components/admin/approval-actions.tsx"), false);
  assert.doesNotMatch(read("components/admin/admin-sidebar.tsx"), /\/admin\/approvals/);
  assert.match(read("app/admin/approvals/page.tsx"), /redirect\("\/admin\/users"\)/);
});

test("banned accounts are routed to the blocked state and refused in every participant mutation", () => {
  const auth = read("lib/auth.ts");
  assert.match(auth, /if \(await isBanned\(profile\.id\)\) redirect\("\/blocked"\);/);
  assert.match(auth, /if \(await isBanned\(profile\.id\)\) return null; \/\/ banned: no admin power/);
  for (const f of ["lib/actions/payment.ts", "lib/actions/general-registration.ts", "lib/actions/profile.ts"]) {
    assert.match(read(f), /await isBanned\(user\.id\)/, f);
  }
  assert.match(read("lib/actions/registration.ts"), /ACCOUNT_BANNED/);
  assert.match(read("app/blocked/page.tsx"), /Your account is suspended/);
});

test("ban/unban is a super-admin-only action over the audited RPC; nothing is deleted", () => {
  const admin = read("lib/actions/admin.ts");
  const fn = admin.slice(admin.indexOf("export async function setUserBan("));
  const body = fn.slice(0, fn.indexOf("\nexport "));
  assert.match(body, /await requireSuperAdmin\(\)/);
  assert.match(body, /rpc\("super_set_user_ban"/);
  assert.doesNotMatch(body, /\.delete\(|auth\.admin\.deleteUser/);
  const sql = read("supabase/migrations/0035_open_signup_bans_event_contacts.sql");
  assert.match(sql, /create table if not exists public\.profile_ban_events/);
  assert.match(sql, /create trigger profile_ban_events_append_only[\s\S]*?execute function public\.guard_append_only\(\);/);
});
