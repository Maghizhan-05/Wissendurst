// Unit tests — run with `npm run test:unit` (node --test, no build step).
// D-026 user correction: Analytics is restricted to the single profile with
// role 'admin' + is_super_admin + participant_id exactly 'supadmin/01',
// enforced by ONE server helper (requireAnalyticsAdmin) on every analytics
// page and the screenshot proxy, and surfaced to the sidebar only as a
// server-derived canViewAnalytics boolean.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ANALYTICS_ADMIN_PARTICIPANT_ID, isAnalyticsAdminProfile } from "./analytics/access.ts";
import { screenshotProxy } from "./analytics/heatmap-proxy.ts";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
function files(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else if (/\.(tsx?|jsx?|mjs)$/.test(n)) out.push(relative(ROOT, f));
    }
  };
  walk(join(ROOT, dir));
  return out;
}

const owner = { role: "admin", is_super_admin: true, participant_id: "supadmin/01" };

test("analytics identity: only admin + super + exactly supadmin/01 is allowed", () => {
  assert.equal(ANALYTICS_ADMIN_PARTICIPANT_ID, "supadmin/01");
  assert.equal(isAnalyticsAdminProfile(owner), true);
  const denied: [string, unknown][] = [
    ["other super admin supadmin/02", { ...owner, participant_id: "supadmin/02" }],
    ["other super admin supadmin/10", { ...owner, participant_id: "supadmin/10" }],
    ["ordinary admin admin/01", { role: "admin", is_super_admin: false, participant_id: "admin/01" }],
    ["supadmin/01 id but not super", { ...owner, is_super_admin: false }],
    ["supadmin/01 id but participant role", { ...owner, role: "participant" }],
    ["event admin (participant with assignments)", { role: "participant", is_super_admin: false, participant_id: "W27/E/0042" }],
    ["no participant id", { ...owner, participant_id: null }],
    ["case variant", { ...owner, participant_id: "SUPADMIN/01" }],
    ["padded", { ...owner, participant_id: " supadmin/01" }],
    ["suffix", { ...owner, participant_id: "supadmin/011" }],
    ["truthy non-boolean super flag", { ...owner, is_super_admin: "true" }],
    ["null", null],
    ["undefined", undefined],
  ];
  for (const [label, p] of denied) assert.equal(isAnalyticsAdminProfile(p as never), false, label);
});

test("one server helper: canViewAnalytics/requireAnalyticsAdmin wrap the identity check", () => {
  const auth = read("lib/auth.ts");
  assert.match(auth, /import \{ isAnalyticsAdminProfile \} from "@\/lib\/analytics\/access";/);
  assert.match(
    auth,
    /export function canViewAnalytics\(access: AdminAccess \| null\): boolean \{\n\s+return !!access && access\.isSuper && isAnalyticsAdminProfile\(access\.profile\);\n\}/,
  );
  assert.match(
    auth,
    /export async function requireAnalyticsAdmin\(\): Promise<ProfileRow> \{\n\s+const access = await requireAdminAccess\(\);\n\s+if \(!canViewAnalytics\(access\)\) redirect\("\/admin"\);\n\s+return access\.profile;\n\}/,
  );
  // isSuper itself already requires role = admin (getAdminAccess).
  assert.match(auth, /isSuper: isAdmin && profile\.is_super_admin,/);
  assert.match(auth, /const isAdmin = profile\.role === "admin";/);
});

test("the literal lives only in lib/analytics/access.ts; no scattered checks", () => {
  for (const f of [...files("app"), ...files("components"), ...files("lib")]) {
    if (f.endsWith(".test.ts") || f === "lib/analytics/access.ts") continue;
    assert.doesNotMatch(read(f), /["'`]supadmin\/01["'`]|ANALYTICS_ADMIN_PARTICIPANT_ID/, f);
  }
  for (const f of [...files("app/admin/analytics"), ...files("components/admin")]) {
    assert.doesNotMatch(read(f), /participant_id\s*===|isAnalyticsAdminProfile/, `${f}: use the server helper`);
  }
});

test("every analytics page and the screenshot route use requireAnalyticsAdmin", () => {
  const analyticsFiles = files("app/admin/analytics").filter((f) => /\/(page|route)\.tsx?$/.test(f));
  assert.deepEqual(analyticsFiles.sort(), [
    "app/admin/analytics/heatmaps/[shortId]/page.tsx",
    "app/admin/analytics/heatmaps/[shortId]/screenshot/route.ts",
    "app/admin/analytics/page.tsx",
  ]);
  for (const f of analyticsFiles) {
    const s = read(f);
    assert.match(s, /import \{ requireAnalyticsAdmin \} from "@\/lib\/auth";/, f);
    assert.doesNotMatch(s, /requireSuperAdmin|isSuper/, f);
  }
});

test("sidebar: Analytics link only from the server-derived canViewAnalytics flag", () => {
  const sidebar = read("components/admin/admin-sidebar.tsx");
  assert.match(sidebar, /\{ href: "\/admin\/analytics", label: "Analytics", icon: BarChart3, analyticsOnly: true \}/);
  assert.match(sidebar, /\(l\.analyticsOnly \? canViewAnalytics === true : true\) &&/);
  assert.match(sidebar, /canViewAnalytics = false,/, "defaults to hidden");
  assert.doesNotMatch(sidebar, /superOnly/);
  assert.doesNotMatch(sidebar, /analyticsOnly \? isSuper/);
  const layout = read("app/admin/layout.tsx");
  assert.match(layout, /canViewAnalytics=\{canViewAnalytics\(access\)\}/);
  assert.match(layout, /import \{ canViewAnalytics, hasAreaAccess, requireAdminAccess \} from "@\/lib\/auth";/);
});

test("screenshot proxy: a denied admin (e.g. supadmin/02) is redirected before any PostHog call", async () => {
  // Simulates requireAnalyticsAdmin: redirect (throw) unless the identity matches.
  const calls: string[] = [];
  const asProfile = (p: typeof owner) => ({
    authorize: async () => {
      calls.push("authorize");
      if (!isAnalyticsAdminProfile(p)) throw new Error("NEXT_REDIRECT /admin");
    },
    getHeatmap: async () => {
      calls.push("getHeatmap");
      return { state: "not-found" as const };
    },
    getScreenshot: async () => {
      calls.push("getScreenshot");
      return { kind: "failed" as const };
    },
  });
  for (const p of [
    { ...owner, participant_id: "supadmin/02" },
    { role: "admin", is_super_admin: false, participant_id: "admin/03" },
    { role: "participant", is_super_admin: false, participant_id: "W27/E/0001" },
  ]) {
    calls.length = 0;
    await assert.rejects(screenshotProxy({ shortId: "AbC123xy", width: "1024" }, asProfile(p)), /NEXT_REDIRECT/);
    assert.deepEqual(calls, ["authorize"], `${p.participant_id}: no provider calls`);
  }
  calls.length = 0;
  const ok = await screenshotProxy({ shortId: "AbC123xy", width: "1024" }, asProfile(owner));
  assert.equal(ok.status, 404);
  assert.deepEqual(calls, ["authorize", "getHeatmap"]);
});
