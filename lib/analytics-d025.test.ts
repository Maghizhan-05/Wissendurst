// Unit tests — run with `npm run test:unit` (node --test, no build step).
// D-025: Vercel Web Analytics gate + single mount, PostHog exception
// redaction, single pageview source, and the super-admin dashboard
// (fail-closed config, typed aggregate parsing, authorization, boundaries).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createVercelBeforeSend, VERCEL_DUPLICATE_WINDOW_MS } from "./analytics/vercel.ts";
import { redactText, sanitizeExceptionList, sanitizeFrameFilename } from "./analytics/redact.ts";
import { sanitizeEvent } from "./analytics/sanitize.ts";
import { buildPostHogConfig } from "./analytics/posthog-options.ts";
import {
  DASHBOARD_QUERIES,
  POSTHOG_EU_APP_HOST,
  loadDashboard,
  parseDashboardConfig,
  parseExceptionTypes,
  parseFunnel,
  parseTopPaths,
  parseTraffic,
  type FetchLike,
} from "./analytics/dashboard.ts";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const origin = "https://wissendurst27.vercel.app";
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

// ── Vercel Web Analytics ─────────────────────────────────────────────────────
test("Vercel beforeSend: live consent + approved route only, pathname-only URLs", () => {
  let allowed = true;
  let now = 0;
  const send = createVercelBeforeSend({ origin, allowed: () => allowed, now: () => now });
  assert.deepEqual(send({ type: "pageview", url: `${origin}/events/robotics?utm=x&email=a@b.co#h` }), {
    type: "pageview",
    url: `${origin}/events/robotics`,
  });
  now += VERCEL_DUPLICATE_WINDOW_MS + 1;
  for (const p of ["/dashboard", "/dashboard/payment/x", "/admin", "/admin/analytics", "/login", "/signup", "/application", "/blocked", "/pending-approval"]) {
    assert.equal(send({ type: "pageview", url: origin + p }), null, p);
  }
  assert.equal(send({ type: "pageview", url: "https://evil.test/events" }), null);
  allowed = false; // withdrawal / GPC: the script outlives the unmount
  assert.equal(send({ type: "pageview", url: `${origin}/about` }), null);
  assert.equal(send({ type: "event", url: `${origin}/about` }), null);
});

test("Vercel beforeSend: no duplicate pageview for the same path; transitions count once each", () => {
  let now = 1000;
  const send = createVercelBeforeSend({ origin, allowed: () => true, now: () => now });
  const pv = (p: string) => send({ type: "pageview", url: origin + p });
  assert.ok(pv("/"));
  assert.equal(pv("/?ref=x"), null, "same path (query ignored) again = duplicate");
  now += 10;
  assert.ok(pv("/events"));
  now += 10;
  assert.ok(pv("/events/robotics"));
  now += 10;
  assert.ok(pv("/events"), "a real return to a page counts");
  now += 10;
  assert.equal(pv("/events"), null);
  now += VERCEL_DUPLICATE_WINDOW_MS + 1;
  assert.ok(pv("/events"), "a later revisit is a new view");
});

test("exactly one Vercel mount: dynamic, consent + route gated, never manual pageviews", () => {
  const sources = [...files("app"), ...files("components"), ...files("lib")].filter((f) => !f.endsWith(".test.ts"));
  const importers = sources.filter((f) => /@vercel\/analytics/.test(read(f)));
  assert.deepEqual(importers, ["components/analytics/vercel-analytics.tsx"]);
  const comp = read("components/analytics/vercel-analytics.tsx");
  assert.match(comp, /import \{ Analytics \} from "@vercel\/analytics\/next";/);
  assert.equal(comp.match(/<Analytics /g)?.length, 1);
  assert.match(comp, /allowed: liveAnalyticsAllowed/);
  const provider = read("components/analytics/analytics-provider.tsx");
  assert.match(provider, /dynamic\(\(\) => import\("\.\/vercel-analytics"\), \{ ssr: false \}\)/);
  assert.equal(provider.match(/<VercelAnalytics \/>/g)?.length, 1);
  assert.match(provider, /\{granted && routeAllowed && <VercelAnalytics \/>\}/);
  for (const f of sources) {
    assert.doesNotMatch(read(f), /window\.va\(|\bpageview\(\{|track\(\s*["']pageview/, f);
    assert.doesNotMatch(read(f), /from ["']@vercel\/analytics(?!\/next)/, f);
  }
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.dependencies["@vercel/analytics"], /^\d+\.\d+\.\d+$/, "exact version pin");
});

// ── PostHog pageviews: one automatic source ──────────────────────────────────
test("PostHog pageviews come only from history_change; pageleave on; no manual capture", () => {
  const c = buildPostHogConfig({ origin, pathname: () => "/", mayCapture: () => true });
  assert.equal(c.capture_pageview, "history_change");
  assert.equal(c.capture_pageleave, true);
  for (const f of [...files("app"), ...files("components"), ...files("lib")].filter((f) => !f.endsWith(".test.ts"))) {
    assert.doesNotMatch(read(f), /capture\(\s*["']\$page(view|leave)["']/, f);
  }
  // pathname-only for every pageview
  const pv = sanitizeEvent(
    { event: "$pageview", properties: { $current_url: `${origin}/events/x?q=1#h`, $pathname: "/events/x", $referrer: "https://g.co/?q" } },
    { origin, pathname: "/events/x" },
  )!;
  assert.deepEqual(pv.properties, { $current_url: `${origin}/events/x`, $pathname: "/events/x" });
  assert.equal(sanitizeEvent({ event: "$pageview", properties: {} }, { origin, pathname: "/dashboard" }), null);
});

// ── PostHog exceptions ───────────────────────────────────────────────────────
const SEEDED = [
  "Failed for someone@college.edu",
  "+91 98765 43210",
  "W27/E/0042",
  "W27/GR/0007",
  "supadmin/07",
  "admin/12",
  "3f2a6c1e-7b4d-4c2a-9e1f-0a1b2c3d4e5f",
  "name@okhdfcbank",
  "UTR 412345678901",
  "txn_ref ABC123XYZ9",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
  "token=sk_live_abcdef123456",
  "https://site.test/pay?utr=999#frag",
  "https://abc.supabase.co/storage/v1/object/sign/id-cards/x.png?token=abc",
  "id-card-scan.JPG",
  "9876543210123",
  "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
];

test("redactText removes every seeded personal/secret pattern", () => {
  const out = redactText(SEEDED.join(" | "), 5000)!;
  for (const leak of [
    "someone@college.edu",
    "98765",
    "W27/",
    "supadmin/07",
    "admin/12",
    "3f2a6c1e",
    "okhdfcbank",
    "412345678901",
    "ABC123XYZ9",
    "eyJhbGci",
    "sk_live",
    "utr=999",
    "#frag",
    "supabase.co",
    "id-card-scan",
    "9876543210123",
    "a1b2c3d4e5f6",
  ]) {
    assert.ok(!out.includes(leak), `leaked ${leak}: ${out}`);
  }
  assert.match(out, /\[email\]/);
  assert.match(out, /\[participant-id\]/);
  assert.match(out, /\[staff-id\]/);
  assert.match(out, /\[uuid\]/);
  assert.match(out, /\[token\]/);
  assert.equal(redactText("TypeError: Cannot read properties of undefined (reading 'map')"), "TypeError: Cannot read properties of undefined (reading 'map')");
  assert.equal(redactText(42), undefined);
  assert.ok(redactText("x".repeat(2000))!.length <= 501);
});

test("$exception: nested messages/stacks are redacted; unknown fields and context dropped", () => {
  const out = sanitizeEvent(
    {
      event: "$exception",
      properties: {
        $current_url: `${origin}/events/robotics?email=a@b.co`,
        $exception_level: "error",
        $exception_personURL: "https://eu.posthog.com/person/abc",
        $exception_steps: [{ message: "typed a@b.co" }],
        $release_id: "build-2026-11-14",
        user_context: { email: "a@b.co" },
        $exception_list: [
          {
            type: "Error for W27/E/0042",
            value: `Payment UTR 412345678901 failed for someone@college.edu at ${origin}/events/x?token=abc`,
            mechanism: { handled: false, synthetic: false, type: "onerror", data: { secret: "x" } },
            raw: "full payload",
            stacktrace: {
              type: "raw",
              frames: [
                {
                  platform: "web:javascript",
                  filename: `${origin}/_next/static/chunks/app-abc123.js?v=1`,
                  abs_path: `${origin}/_next/static/chunks/app-abc123.js`,
                  function: "submit_someone@college.edu",
                  lineno: 12,
                  colno: 34,
                  in_app: true,
                  context_line: "const email = 'a@b.co';",
                  pre_context: ["password = 'x'"],
                  vars: { email: "a@b.co" },
                },
                { platform: "web:javascript", filename: "chrome-extension://abc/content.js", lineno: 1, colno: 1 },
              ],
            },
          },
        ],
      },
    },
    { origin, pathname: "/events/robotics" },
  )!;
  const p = out.properties!;
  assert.deepEqual(Object.keys(p).sort(), ["$current_url", "$exception_level", "$exception_list", "$release_id"]);
  assert.equal(p.$current_url, `${origin}/events/robotics`);
  const json = JSON.stringify(p);
  for (const leak of ["a@b.co", "someone@college.edu", "W27/E", "412345678901", "token=abc", "context_line", "pre_context", "vars", "chrome-extension", "?v=1", "personURL", "exception_steps", "user_context", "full payload"]) {
    assert.ok(!json.includes(leak), `leaked ${leak}`);
  }
  const ex = (p.$exception_list as Record<string, unknown>[])[0];
  assert.deepEqual(ex.mechanism, { handled: false, synthetic: false, type: "onerror" });
  const frames = (ex.stacktrace as { frames: Record<string, unknown>[] }).frames;
  assert.equal(frames[0].filename, `${origin}/_next/static/chunks/app-abc123.js`, "same-origin chunk path kept for source maps");
  assert.deepEqual([frames[0].lineno, frames[0].colno, frames[0].in_app], [12, 34, true]);
  assert.equal(frames[1].filename, "[native]");
});

test("$exception is dropped off-route or without a usable exception list", () => {
  const ev = { event: "$exception", properties: { $exception_list: [{ type: "Error", value: "x" }] } };
  for (const p of ["/dashboard", "/admin", "/admin/analytics", "/login", "/application", "/dashboard/payment/x"]) {
    assert.equal(sanitizeEvent(ev, { origin, pathname: p }), null, p);
  }
  assert.ok(sanitizeEvent(ev, { origin, pathname: "/events" }));
  assert.equal(sanitizeEvent({ event: "$exception", properties: { $exception_list: [] } }, { origin, pathname: "/" }), null);
  assert.equal(sanitizeEvent({ event: "$exception", properties: { $exception_list: "nope" } }, { origin, pathname: "/" }), null);
  assert.equal(sanitizeExceptionList([{ mechanism: { handled: true } }], origin), null);
  assert.equal(sanitizeFrameFilename("https://cdn.evil.test/x.js", origin), "[external]");
});

test("handled errors go only through the consent-gated bridge from the public boundary", () => {
  const boundary = read("app/(public)/error.tsx");
  assert.match(boundary, /import \{ captureError \} from "@\/components\/analytics\/bridge";/);
  assert.match(boundary, /captureError\(error\);/);
  const bridge = read("components/analytics/bridge.ts");
  assert.match(bridge, /export function captureError\(error: unknown\): void \{\n\s+if \(!bridge\.routeAllowed \|\| !bridge\.runtime \|\| !liveAnalyticsAllowed\(\)\) return;/);
  const rt = read("components/analytics/posthog-runtime.ts");
  assert.match(rt, /captureError\(error\) \{\n\s+if \(!mayCapture\(\)\) return;\n[^\n]*\n\s+posthog\.captureException\(error\);/);
  // Sensitive route trees keep their own boundaries without analytics.
  for (const f of ["app/error.tsx"]) assert.doesNotMatch(read(f), /captureError|posthog|analytics/i, f);
});

// ── lifecycle regressions found by the D-025 browser probe ───────────────────
test("lifecycle: live event gate, re-grant re-opts in, remount reads the live cookie", () => {
  const rt = read("components/analytics/posthog-runtime.ts");
  assert.match(rt, /function mayCapture\(\): boolean \{\n\s+return !revoked && liveAnalyticsAllowed\(\);\n\}/);
  assert.match(rt, /revoke\(\) \{[\s\S]*?revoked = true;[\s\S]*?posthog\.opt_out_capturing\(\);/);
  assert.match(rt, /startRuntime\(token: string, firstGrant: boolean\): AnalyticsRuntime \{\n\s+suspended = false;\n\s+revoked = false;/);
  const provider = read("components/analytics/analytics-provider.tsx");
  assert.match(provider, /bridge\.runtime\?\.revoke\(\);\n[^\n]*\n\s+bridge\.runtime = null;\n\s+bridge\.granted = false;/);
  assert.match(provider, /!hydrated \? initialStored : readConsentFromCookieString\(document\.cookie\)/);
  const bridge = read("components/analytics/bridge.ts");
  assert.match(bridge, /readConsentFromCookieString\(document\.cookie\) === "granted" &&\n\s+!browserSignalDenial\(/);
  assert.match(bridge, /isAnalyticsRoute\(window\.location\.pathname\)/);
});

// ── super-admin dashboard ────────────────────────────────────────────────────
const KEY = "phx_" + "A1b2C3d4".repeat(5);

test("dashboard config fails closed: missing, malformed, or public token", () => {
  assert.deepEqual(parseDashboardConfig({}), { ok: false, reason: "missing" });
  assert.deepEqual(parseDashboardConfig({ POSTHOG_PERSONAL_API_KEY: KEY }), { ok: false, reason: "missing" });
  assert.deepEqual(parseDashboardConfig({ POSTHOG_PERSONAL_API_KEY: "phc_" + "x".repeat(30), POSTHOG_PROJECT_ID: "123" }), { ok: false, reason: "invalid" });
  assert.deepEqual(parseDashboardConfig({ POSTHOG_PERSONAL_API_KEY: KEY, POSTHOG_PROJECT_ID: "12a" }), { ok: false, reason: "invalid" });
  assert.deepEqual(parseDashboardConfig({ POSTHOG_PERSONAL_API_KEY: ` ${KEY} `, POSTHOG_PROJECT_ID: " 98765 " }), {
    ok: true,
    config: { apiKey: KEY, projectId: "98765" },
  });
});

test("dashboard queries are aggregates only (no person/distinct/session rows)", () => {
  for (const [name, q] of Object.entries(DASHBOARD_QUERIES)) {
    assert.match(q, /^SELECT /, name);
    assert.doesNotMatch(q, /distinct_id|person|\$ip|properties\.\$current_url|\$exception_list(?!, 1, 'type')|\$elements|\$snapshot|SELECT \*/i, name);
    assert.match(q, /count\(|countIf\(/, name);
    assert.match(q, /INTERVAL 30 DAY/, name);
  }
});

test("typed aggregate parsing rejects malformed rows and filters non-public paths", () => {
  assert.deepEqual(parseTraffic([[120, 45]]), { pageviews: 120, sessions: 45 });
  assert.equal(parseTraffic([["x", 1]]), null);
  assert.equal(parseTraffic([]), null);
  assert.deepEqual(
    parseTopPaths([["/events", 50], ["/dashboard", 9], ["/events/", 5], ["/admin/analytics", 3], [null, 2], ["/events/robotics", 7]]),
    [{ path: "/events", views: 55 }, { path: "/events/robotics", views: 7 }],
  );
  assert.equal(parseTopPaths([["/events", -1]]), null);
  assert.deepEqual(parseFunnel([[10, 4]]), { started: 10, confirmed: 4, rate: 0.4 });
  assert.deepEqual(parseFunnel([[0, 0]]), { started: 0, confirmed: 0, rate: null });
  assert.deepEqual(parseExceptionTypes([["TypeError", 3], ["", 1], ["Error for a@b.co W27/E/0001", 2]]), [
    { type: "TypeError", total: 3 },
    { type: "Unknown", total: 1 },
    { type: "Error for [email] [participant-id]", total: 2 },
  ]);
  assert.equal(parseExceptionTypes([["TypeError", "x"]]), null);
});

function fakeFetch(handler: (q: string) => { status: number; body?: unknown }) {
  const calls: { url: string; auth: string; body: string }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization, body: init.body });
    const q = (JSON.parse(init.body) as { query: { query: string } }).query.query;
    const r = handler(q);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  return { f, calls };
}

test("dashboard client: not configured, rejected, partial failure and success", async () => {
  const none = fakeFetch(() => ({ status: 200, body: { results: [] } }));
  assert.deepEqual(await loadDashboard({}, none.f), { state: "not-configured", reason: "missing" });
  assert.equal(none.calls.length, 0, "no request without configuration");

  const rejected = fakeFetch(() => ({ status: 401, body: { detail: "Invalid key" } }));
  assert.deepEqual(await loadDashboard({ POSTHOG_PERSONAL_API_KEY: KEY, POSTHOG_PROJECT_ID: "42" }, rejected.f), { state: "rejected" });

  const ok = fakeFetch((q) => {
    if (q === DASHBOARD_QUERIES.traffic) return { status: 200, body: { results: [[100, 40]] } };
    if (q === DASHBOARD_QUERIES.topPaths) return { status: 200, body: { results: [["/", 60], ["/admin", 5]] } };
    if (q === DASHBOARD_QUERIES.funnel) return { status: 200, body: { results: [[8, 2]] } };
    if (q === DASHBOARD_QUERIES.exceptions) return { status: 500, body: {} };
    return { status: 200, body: { results: "malformed" } };
  });
  const res = await loadDashboard({ POSTHOG_PERSONAL_API_KEY: KEY, POSTHOG_PROJECT_ID: "42" }, ok.f);
  assert.equal(res.state, "ok");
  if (res.state !== "ok") return;
  assert.deepEqual(res.data.traffic, { ok: true, data: { pageviews: 100, sessions: 40 } });
  assert.deepEqual(res.data.topPaths, { ok: true, data: [{ path: "/", views: 60 }] });
  assert.deepEqual(res.data.funnel, { ok: true, data: { started: 8, confirmed: 2, rate: 0.25 } });
  assert.deepEqual(res.data.exceptions, { ok: false });
  assert.deepEqual(res.data.exceptionTypes, { ok: false });
  assert.ok(ok.calls.every((c) => c.url === `${POSTHOG_EU_APP_HOST}/api/projects/42/query/` && c.auth === `Bearer ${KEY}`));
  assert.ok(ok.calls.every((c) => JSON.parse(c.body).query.kind === "HogQLQuery"));
});

test("/admin/analytics: super-admin gate, server-only key, no client SDK, aggregates only", () => {
  const page = read("app/admin/analytics/page.tsx");
  assert.match(page, /await requireSuperAdmin\(\);/);
  assert.ok(page.indexOf("await requireSuperAdmin()") < page.indexOf("await getAnalyticsDashboard()"), "authorize before loading");
  assert.doesNotMatch(page, /"use client"|posthog-js|@vercel\/analytics|components\/analytics|<iframe/);
  assert.doesNotMatch(page, /supadmin\/01|participant_id/);
  assert.match(read("lib/auth.ts"), /export async function requireSuperAdmin\(\): Promise<ProfileRow> \{\n\s+const access = await requireAdminAccess\(\);\n\s+if \(!access\.isSuper\) redirect\("\/admin"\);/);
  const loader = read("lib/data/analytics-dashboard.ts");
  assert.match(loader, /^import "server-only";/);
  assert.match(loader, /process\.env\.POSTHOG_PERSONAL_API_KEY/);
  for (const f of [...files("app"), ...files("components"), ...files("lib")]) {
    if (f === "lib/data/analytics-dashboard.ts" || f.endsWith(".test.ts")) continue;
    assert.doesNotMatch(read(f), /process\.env\.POSTHOG_(PERSONAL_API_KEY|PROJECT_ID)|NEXT_PUBLIC_POSTHOG_(PERSONAL|PROJECT_ID)/, f);
  }
  for (const f of files("components")) assert.doesNotMatch(read(f), /analytics-dashboard|lib\/analytics\/dashboard/, f);
  assert.doesNotMatch(read("lib/analytics/dashboard.ts"), /NEXT_PUBLIC_/);
  assert.doesNotMatch(read("app/admin/layout.tsx"), /AnalyticsProvider|posthog|@vercel\/analytics/i);
  // Sidebar: visible only to super admins.
  const sidebar = read("components/admin/admin-sidebar.tsx");
  assert.match(sidebar, /\{ href: "\/admin\/analytics", label: "Analytics", icon: BarChart3, superOnly: true \}/);
  assert.match(sidebar, /\(l\.superOnly \? isSuper : true\) &&/);
  assert.doesNotMatch(sidebar, /supadmin/);
});
