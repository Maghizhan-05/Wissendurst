// Unit tests — run with `npm run test:unit` (node --test, no build step).
// D-026: rich /admin/analytics — range validation, typed Trends/Funnels/HogQL
// builders and parsers, section isolation, privacy-safe category folding,
// saved-heatmap parsing/filtering, the screenshot proxy and source boundaries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  DASHBOARD_TASKS,
  POSTHOG_EU_APP_HOST,
  QUERY_REVALIDATE_SECONDS,
  dayAxis,
  foldBuckets,
  funnelsQuery,
  hogqlQueries,
  loadDashboard,
  normalizeCategory,
  parseDashboardConfig,
  parseExceptionTypes,
  parseFunnel,
  parseRange,
  parseTopPaths,
  parseTrends,
  trendsQuery,
  type FetchInit,
  type FetchLike,
} from "./analytics/dashboard.ts";
import {
  MAX_SCREENSHOT_BYTES,
  chooseWidth,
  fetchScreenshot,
  getSavedHeatmap,
  limitStream,
  listItems,
  listSavedHeatmaps,
  parseSavedHeatmap,
  parseWidth,
  siteOrigins,
  type HeatmapDetail,
  type SavedHeatmap,
  type ScreenshotResult,
} from "./analytics/heatmaps.ts";
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

const KEY = "phx_" + "A1b2C3d4".repeat(5);
const ENV = { POSTHOG_PERSONAL_API_KEY: KEY, POSTHOG_PROJECT_ID: "4242" };
const SITE = "https://wissendurst27.vercel.app";
const CFG = { apiKey: KEY, projectId: "4242" };

type Call = { url: string; init: FetchInit; query?: { kind: string; query?: string } };
function fakeFetch(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  let inflight = 0;
  let peak = 0;
  const f: FetchLike = async (url, init) => {
    const c: Call = { url, init, query: init.body ? JSON.parse(String(init.body)).query : undefined };
    calls.push(c);
    inflight++;
    peak = Math.max(peak, inflight);
    await new Promise((r) => setTimeout(r, 1));
    try {
      return await handler(c);
    } finally {
      inflight--;
    }
  };
  return { f, calls, peak: () => peak };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const rows = (r: unknown[][]) => json({ results: r, columns: [], types: [] });
const scope403 = (scope: string) => json({ type: "authentication_error", code: "permission_denied", detail: `API key missing required scope '${scope}'` }, 403);

// ── range ────────────────────────────────────────────────────────────────────
test("range: only 7/30/90 via ?range=, everything else → 30", () => {
  assert.equal(parseRange("7"), 7);
  assert.equal(parseRange("30"), 30);
  assert.equal(parseRange(["90", "7"]), 90);
  for (const bad of [undefined, "", "14", "7d", " 7", "90; DROP", "1e1", "-7", "365", 7]) assert.equal(parseRange(bad), 30, String(bad));
});

// ── query builders ───────────────────────────────────────────────────────────
test("typed Trends/Funnels requests are range-parameterized and aggregate-only", () => {
  for (const [d, from] of [[7, "-6d"], [30, "-29d"], [90, "-89d"]] as const) {
    const t = trendsQuery(d);
    assert.equal(t.kind, "TrendsQuery");
    assert.equal(t.interval, "day");
    assert.deepEqual(t.dateRange, { date_from: from, date_to: null });
    assert.deepEqual(t.series.map((s) => [s.kind, s.event, s.math]), [["EventsNode", "$pageview", "total"], ["EventsNode", "$exception", "total"]]);
    const f = funnelsQuery(d);
    assert.equal(f.kind, "FunnelsQuery");
    assert.deepEqual(f.dateRange, { date_from: from, date_to: null });
    assert.deepEqual(f.series.map((s) => s.event), ["registration_started", "free_registration_confirmed"]);
    assert.deepEqual(f.funnelsFilter, { funnelVizType: "steps", funnelOrderType: "ordered", funnelWindowInterval: 14, funnelWindowIntervalUnit: "day" });
    assert.ok(!("breakdownFilter" in f) && !("breakdownFilter" in t), "no breakdown by person/property");
  }
});

test("HogQL fallbacks: enumerated window, counts/dates/paths/categories only", () => {
  for (const [d, back] of [[7, 6], [30, 29], [90, 89]] as const) {
    for (const [name, q] of Object.entries(hogqlQueries(d))) {
      assert.match(q, new RegExp(`timestamp >= toStartOfDay\\(now\\(\\)\\) - INTERVAL ${back} DAY`), name);
      assert.match(q, /^SELECT /, name);
      assert.match(q, /count\(|countIf\(/, name);
      assert.doesNotMatch(q, /distinct_id|person|\$ip|\$current_url|\$referrer|\$snapshot|\$elements|\$browser_version|\$os_version|SELECT \*/i, name);
      if (/GROUP BY/.test(q)) assert.match(q, /LIMIT \d+$/, name);
    }
  }
});

// ── parsers ──────────────────────────────────────────────────────────────────
const trendItem = (id: string, data: number[], days = ["2026-11-12", "2026-11-13", "2026-11-14"]) => ({
  action: { id, type: "events", name: id, math: "total" },
  label: id,
  count: data.reduce((a, b) => a + b, 0),
  data,
  days,
  labels: days.map((x) => x),
});

test("parseTrends: strict documented series shape, else null (→ HogQL fallback)", () => {
  const ok = parseTrends({ results: [trendItem("$pageview", [3, 0, 9]), trendItem("$exception", [0, 1, 0])] }, ["$pageview", "$exception"]);
  assert.deepEqual(ok, {
    $pageview: { days: ["2026-11-12", "2026-11-13", "2026-11-14"], values: [3, 0, 9] },
    $exception: { days: ["2026-11-12", "2026-11-13", "2026-11-14"], values: [0, 1, 0] },
  });
  const ev = ["$pageview", "$exception"];
  assert.equal(parseTrends({ results: [trendItem("$pageview", [1, 2, 3])] }, ev), null, "missing series");
  assert.equal(parseTrends({ results: [trendItem("$pageview", [1, 2]), trendItem("$exception", [0, 0, 0])] }, ev), null, "length mismatch");
  assert.equal(parseTrends({ results: [trendItem("$pageview", [1, -2, 3]), trendItem("$exception", [0, 0, 0])] }, ev), null, "negative");
  assert.equal(parseTrends({ results: [trendItem("$pageview", [1, 2, 3], ["a", "b", "c"]), trendItem("$exception", [0, 0, 0])] }, ev), null, "bad days");
  assert.equal(parseTrends({ results: [trendItem("$pageview", [1, 2, 3]), trendItem("$pageview", [0, 0, 0])] }, ev), null, "duplicate");
  assert.equal(parseTrends({ results: "x" }, ev), null);
  assert.equal(parseTrends({ results: [trendItem("$pageview", [1, 1, 1]), trendItem("$exception", [0, 0, 0], ["2026-11-11", "2026-11-12", "2026-11-13"])] }, ev), null, "misaligned days");
});

test("parseFunnel: two ordered steps (flat or single group), else null", () => {
  const ev = ["registration_started", "free_registration_confirmed"];
  const steps = [
    { action_id: "registration_started", name: "registration_started", order: 0, count: 40, average_conversion_time: null },
    { action_id: "free_registration_confirmed", name: "free_registration_confirmed", order: 1, count: 12, average_conversion_time: 31.5 },
  ];
  assert.deepEqual(parseFunnel({ results: steps }, ev), { started: 40, confirmed: 12 });
  assert.deepEqual(parseFunnel({ results: [steps] }, ev), { started: 40, confirmed: 12 });
  assert.equal(parseFunnel({ results: [steps[1], steps[0]] }, ev), null);
  assert.equal(parseFunnel({ results: [steps[0]] }, ev), null);
  assert.equal(parseFunnel({ results: [steps[0], { ...steps[1], count: 41 }] }, ev), null, "more confirmed than started");
  assert.equal(parseFunnel({ results: [steps[0], { ...steps[1], action_id: "x", name: "x" }] }, ev), null);
  assert.equal(parseFunnel({ results: [steps, steps] }, ev), null, "breakdown groups are not accepted");
});

test("top paths: public routes only, ranked, exact totals; exception types redacted", () => {
  assert.deepEqual(
    parseTopPaths([["/events", 50], ["/dashboard", 9], ["/events/", 5], ["/admin/analytics", 3], [null, 2], ["/events/robotics", 7], ["/login", 4]]),
    [{ path: "/events", views: 55 }, { path: "/events/robotics", views: 7 }],
  );
  assert.deepEqual(parseExceptionTypes([["TypeError", 3], ["Error for a@b.co", 2], ["Error for c@d.co", 1]]), [
    { type: "TypeError", total: 3 },
    { type: "Error for [email]", total: 3 },
  ]);
  const t = parseExceptionTypes([["Error W27/E/0042 a@b.co", 2]])!;
  assert.equal(t[0].type, "Error [participant-id] [email]");
});

// ── privacy-safe categories ──────────────────────────────────────────────────
test("browser/OS/device: major names only, no versions, < 5 folded into Other", () => {
  const cases: [Parameters<typeof normalizeCategory>[0], string, string][] = [
    ["browser", "Chrome", "Chrome"],
    ["browser", "Chrome iOS", "Chrome"],
    ["browser", "Mobile Safari", "Safari"],
    ["browser", "Safari", "Safari"],
    ["browser", "Microsoft Edge", "Edge"],
    ["browser", "Firefox iOS", "Firefox"],
    ["browser", "Samsung Internet", "Samsung Internet"],
    ["browser", "Opera", "Opera"],
    ["browser", "Facebook Mobile", "Other"],
    ["browser", "Chrome 141.0.7390", "Chrome"],
    ["os", "Mac OS X", "macOS"],
    ["os", "iOS", "iOS"],
    ["os", "Android", "Android"],
    ["os", "Windows", "Windows"],
    ["os", "Linux", "Linux"],
    ["os", "Chrome OS", "ChromeOS"],
    ["os", "Windows Phone 8.1", "Windows"],
    ["os", "PlayStation", "Other"],
    ["device", "Mobile", "Mobile"],
    ["device", "Desktop", "Desktop"],
    ["device", "Tablet", "Tablet"],
    ["device", "Console", "Other"],
    ["device", "", "Other"],
  ];
  for (const [dim, raw, want] of cases) assert.equal(normalizeCategory(dim, raw), want, `${dim} ${raw}`);
  assert.equal(normalizeCategory("browser", null), "Other");

  const folded = foldBuckets("browser", [["Chrome", 40], ["Mobile Safari", 3], ["Safari", 3], ["Firefox", 4], ["Opera", 1], ["Facebook Mobile", 2], ["Microsoft Edge", 5]])!;
  assert.deepEqual(folded, [
    { name: "Chrome", total: 40 },
    { name: "Safari", total: 6 },
    { name: "Edge", total: 5 },
    { name: "Other", total: 7 },
  ]);
  for (const b of folded) assert.doesNotMatch(b.name, /\d/);
  assert.deepEqual(foldBuckets("device", [["Desktop", 4]]), [{ name: "Other", total: 4 }], "a lone small bucket is still folded");
  assert.deepEqual(foldBuckets("os", []), []);
  assert.equal(foldBuckets("os", [["iOS", "x"]]), null);
});

// ── loadDashboard ────────────────────────────────────────────────────────────
function fullResponder(opts: { trends?: "ok" | "bad"; fail?: string[] } = {}) {
  return (c: Call) => {
    const q = c.query!;
    if (q.kind === "TrendsQuery") {
      return opts.trends === "bad" ? json({ results: [{ nope: 1 }] }) : json({ results: [trendItem("$pageview", [5, 0, 7]), trendItem("$exception", [1, 0, 2])] });
    }
    if (q.kind === "FunnelsQuery") {
      return json({ results: [{ action_id: "registration_started", name: "registration_started", order: 0, count: 10 }, { action_id: "free_registration_confirmed", name: "free_registration_confirmed", order: 1, count: 4 }] });
    }
    const s = q.query!;
    for (const f of opts.fail ?? []) if (s.includes(f)) return json({ detail: "boom" }, 500);
    if (s.includes("count(DISTINCT properties.$session_id) AS sessions FROM events WHERE event = '$pageview' AND timestamp") && !s.includes("toDate")) return rows([[12, 5]]);
    if (s.includes("AS started")) return rows([[11, 4, 3]]);
    if (s.includes("toDate(timestamp) AS day, count() AS pageviews")) return rows([["2026-11-12", 5, 2], ["2026-11-14", 7, 3]]);
    if (s.includes("toDate(timestamp) AS day, count() AS total")) return rows([["2026-11-13", 2]]);
    if (s.includes("$pathname")) return rows([["/", 8], ["/events", 4], ["/dashboard", 2]]);
    if (s.includes("$browser")) return rows([["Chrome", 9], ["Firefox", 2], ["Safari", 1]]);
    if (s.includes("$os")) return rows([["Android", 6], ["Windows", 6]]);
    if (s.includes("$device_type")) return rows([["Mobile", 6], ["Desktop", 6]]);
    if (s.includes("$exception_list")) return rows([["TypeError", 3]]);
    return json({ detail: "unexpected" }, 500);
  };
}

test("loadDashboard: not configured → no request; range flows into every query", async () => {
  const none = fakeFetch(() => json({}));
  assert.deepEqual(await loadDashboard({}, 7, none.f), { state: "not-configured", reason: "missing", range: 7 });
  assert.equal(none.calls.length, 0);
  assert.deepEqual(parseDashboardConfig({ ...ENV, POSTHOG_PERSONAL_API_KEY: "phc_" + "x".repeat(30) }), { ok: false, reason: "invalid" });

  const f = fakeFetch(fullResponder());
  const res = await loadDashboard(ENV, 7, f.f, () => "2026-11-14");
  assert.equal(res.state, "ok");
  assert.equal(f.calls.length, DASHBOARD_TASKS.length, "bounded: one call per section, no fallback needed");
  assert.ok(f.peak() <= 4, `concurrency ${f.peak()}`);
  for (const c of f.calls) {
    assert.equal(c.url, `${POSTHOG_EU_APP_HOST}/api/projects/4242/query/`);
    assert.equal(c.init.method, "POST");
    assert.deepEqual(c.init.next, { revalidate: QUERY_REVALIDATE_SECONDS }, "short server cache");
    assert.equal((c.init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
    if (c.query!.kind === "HogQLQuery") assert.match(c.query!.query!, /INTERVAL 6 DAY/);
    else assert.equal((c.query as unknown as { dateRange: { date_from: string } }).dateRange.date_from, "-6d");
  }
  if (res.state !== "ok") return;
  const d = res.data;
  assert.deepEqual(d.kpis, { ok: true, data: { pageviews: 12, sessions: 5, started: 11, confirmed: 4 } });
  assert.deepEqual(d.daily, {
    ok: true,
    data: {
      source: "trends",
      points: [
        { day: "2026-11-12", pageviews: 5, sessions: 2 },
        { day: "2026-11-13", pageviews: 0, sessions: 0 },
        { day: "2026-11-14", pageviews: 7, sessions: 3 },
      ],
    },
  });
  assert.deepEqual(d.funnel, { ok: true, data: { started: 10, confirmed: 4, mode: "funnel", dropOff: 6, conversion: 0.4 } });
  assert.deepEqual(d.topPaths, { ok: true, data: [{ path: "/", views: 8 }, { path: "/events", views: 4 }] });
  assert.deepEqual(d.breakdowns.browser, { ok: true, data: [{ name: "Chrome", total: 9 }, { name: "Other", total: 3 }] });
  assert.deepEqual(d.exceptions, { ok: true, data: { total: 3, points: [{ day: "2026-11-12", count: 1 }, { day: "2026-11-13", count: 0 }, { day: "2026-11-14", count: 2 }] } });
  assert.deepEqual(d.exceptionTypes, { ok: true, data: [{ type: "TypeError", total: 3 }] });
});

test("loadDashboard: unknown Trends shape → HogQL fallback (daily + one exceptions query); sections isolated", async () => {
  const f = fakeFetch(fullResponder({ trends: "bad", fail: ["$pathname", "$browser"] }));
  const res = await loadDashboard(ENV, 7, f.f, () => "2026-11-14");
  assert.equal(res.state, "ok");
  if (res.state !== "ok") return;
  assert.equal(f.calls.length, DASHBOARD_TASKS.length + 1, "exactly one fallback call");
  assert.deepEqual(res.data.daily.ok && res.data.daily.data.source, "hogql");
  assert.equal(res.data.daily.ok && res.data.daily.data.points.length, 7);
  assert.deepEqual(res.data.daily.ok && res.data.daily.data.points.at(-1), { day: "2026-11-14", pageviews: 7, sessions: 3 });
  assert.deepEqual(res.data.exceptions.ok && res.data.exceptions.data.total, 2);
  assert.deepEqual(res.data.topPaths, { ok: false });
  assert.deepEqual(res.data.breakdowns.browser, { ok: false });
  assert.equal(res.data.breakdowns.os.ok, true);
  assert.equal(res.data.kpis.ok, true);
});

test("loadDashboard: funnel shape unknown → event totals mode", async () => {
  const base = fullResponder();
  const f = fakeFetch((c) => (c.query!.kind === "FunnelsQuery" ? json({ results: { weird: true } }) : base(c)));
  const res = await loadDashboard(ENV, 30, f.f);
  assert.ok(res.state === "ok" && res.data.funnel.ok);
  if (res.state === "ok" && res.data.funnel.ok) assert.deepEqual(res.data.funnel.data, { started: 11, confirmed: 4, mode: "totals", dropOff: 7, conversion: 4 / 11 });
});

test("loadDashboard: all 401 → rejected; all missing query:read → missing-scope; outages stay per-section", async () => {
  assert.deepEqual(await loadDashboard(ENV, 30, fakeFetch(() => json({ detail: "Invalid" }, 401)).f), { state: "rejected", range: 30 });
  assert.deepEqual(await loadDashboard(ENV, 30, fakeFetch(() => scope403("query:read")).f), { state: "missing-scope", scope: "query:read", range: 30 });
  assert.deepEqual(await loadDashboard(ENV, 30, fakeFetch(() => json({ detail: "nope" }, 403)).f), { state: "rejected", range: 30 });
  const down = await loadDashboard(ENV, 30, fakeFetch(() => json({}, 503)).f);
  assert.equal(down.state, "ok");
  if (down.state === "ok") for (const v of [down.data.kpis, down.data.daily, down.data.funnel, down.data.topPaths, down.data.exceptions]) assert.deepEqual(v, { ok: false });
  const thrown = await loadDashboard(ENV, 30, (async () => {
    throw new Error("network");
  }) as FetchLike);
  assert.equal(thrown.state, "ok");
});

test("dayAxis fills the requested inclusive range", () => {
  assert.deepEqual(dayAxis("2026-03-01", 3), ["2026-02-27", "2026-02-28", "2026-03-01"]);
  assert.equal(dayAxis("2026-11-14", 90).length, 90);
  assert.deepEqual(dayAxis("nope", 3), []);
});

// ── saved heatmaps ───────────────────────────────────────────────────────────
const H_ID = "497f6eca-6276-4993-bfeb-53cbbbba6f08";
const heatmapApi = (over: Record<string, unknown> = {}) => ({
  id: H_ID,
  short_id: "AbC123xy",
  name: "Home — launch week",
  url: `${SITE}/?utm_source=x#top`,
  data_url: `${SITE}/`,
  target_widths: [375, 1024, 1440],
  type: "screenshot",
  source: "server",
  status: "completed",
  has_content: true,
  snapshots: [
    { width: 375, has_content: true },
    { width: 1024, has_content: true },
    { width: 1440, has_content: false },
  ],
  deleted: false,
  block_consent_modals: false,
  created_by: {
    id: 7,
    uuid: "095be615-a8ad-4c33-8e9c-c7612fbf6c9f",
    distinct_id: "owner-distinct",
    first_name: "Owner",
    last_name: "Person",
    email: "owner@example.com",
    is_email_verified: true,
    hedgehog_config: {},
    role_at_organization: "engineering",
  },
  created_at: "2026-11-10T10:00:00Z",
  updated_at: "2026-11-12T10:00:00Z",
  exception: "Browserless said: secret internal detail",
  user_access_level: "editor",
  ...over,
});

test("saved heatmap parsing: creator/exception stripped, path only, ready widths", () => {
  const h = parseSavedHeatmap(heatmapApi(), [SITE])!;
  assert.deepEqual(h, {
    id: H_ID,
    shortId: "AbC123xy",
    name: "Home — launch week",
    path: "/",
    status: "completed",
    readyWidths: [375, 1024],
    targetWidths: [375, 1024, 1440],
    updatedAt: "2026-11-12T10:00:00Z",
  });
  const s = JSON.stringify(h);
  for (const leak of ["owner", "Owner", "095be615", "distinct", "email", "Browserless", "utm_source", "#top", "editor", "data_url"]) {
    assert.ok(!s.includes(leak), `leaked ${leak}`);
  }
  assert.equal(parseSavedHeatmap(heatmapApi({ name: "Mail me a@b.co" }), [SITE])!.name, "Mail me [email]");
});

test("saved heatmap filtering: cross-origin, non-public, deleted, non-screenshot, malformed → hidden", () => {
  const origins = [SITE];
  for (const over of [
    { url: "https://evil.example/" },
    { url: "http://wissendurst27.vercel.app/" },
    { url: `${SITE}/dashboard` },
    { url: `${SITE}/admin/analytics` },
    { url: `${SITE}/login` },
    { deleted: true },
    { type: "iframe" },
    { id: "not-a-uuid" },
    { short_id: "../x" },
    { status: "weird" },
    { url: "not a url" },
  ]) {
    assert.equal(parseSavedHeatmap(heatmapApi(over), origins), null, JSON.stringify(over));
  }
  assert.ok(parseSavedHeatmap(heatmapApi({ url: `${SITE}/events/robotics` }), origins));
  assert.deepEqual(listItems({ count: 1, results: [1] }), [1]);
  assert.deepEqual(listItems([{ count: 1, results: [2] }]), [2]);
  assert.equal(listItems([heatmapApi()])?.length, 1);
  assert.equal(listItems({ nope: 1 }), null);
});

test("siteOrigins: https production origins only", () => {
  assert.deepEqual(siteOrigins({ NEXT_PUBLIC_SITE_URL: `${SITE}/`, VERCEL_PROJECT_PRODUCTION_URL: "wissendurst27.vercel.app" }), [SITE]);
  assert.deepEqual(siteOrigins({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }), ["http://localhost:3000"]);
  assert.deepEqual(siteOrigins({ NEXT_PUBLIC_SITE_URL: "http://example.com" }), []);
  assert.deepEqual(siteOrigins({}), []);
});

test("listSavedHeatmaps: read-only GET, states for scope/rejection/empty/hidden", async () => {
  const ok = fakeFetch(() => json({ count: 3, results: [heatmapApi(), heatmapApi({ id: "597f6eca-6276-4993-bfeb-53cbbbba6f08", short_id: "zz", url: "https://other.site/" }), heatmapApi({ id: "697f6eca-6276-4993-bfeb-53cbbbba6f08", short_id: "yy", url: `${SITE}/dashboard` })] }));
  const list = await listSavedHeatmaps(CFG, [SITE], ok.f);
  assert.equal(list.state, "ok");
  if (list.state === "ok") {
    assert.equal(list.items.length, 1);
    assert.equal(list.hidden, 2);
  }
  assert.equal(ok.calls.length, 1);
  assert.equal(ok.calls[0].init.method, "GET");
  assert.match(ok.calls[0].url, /^https:\/\/eu\.posthog\.com\/api\/projects\/4242\/saved\/\?type=screenshot&order=-updated_at&limit=\d+$/);
  assert.equal(ok.calls[0].init.body, undefined);

  assert.deepEqual(await listSavedHeatmaps(CFG, [SITE], fakeFetch(() => scope403("heatmap:read")).f), { state: "missing-scope" });
  assert.deepEqual(await listSavedHeatmaps(CFG, [SITE], fakeFetch(() => json({ detail: "You do not have access" }, 403)).f), { state: "rejected" });
  assert.deepEqual(await listSavedHeatmaps(CFG, [SITE], fakeFetch(() => json({ detail: "Invalid" }, 401)).f), { state: "rejected" });
  assert.deepEqual(await listSavedHeatmaps(CFG, [SITE], fakeFetch(() => json({}, 500)).f), { state: "failed" });
  assert.deepEqual(await listSavedHeatmaps(CFG, [SITE], fakeFetch(() => json({ count: 0, results: [] })).f), { state: "ok", items: [], hidden: 0 });
  assert.deepEqual(await listSavedHeatmaps(null, [SITE], ok.f), { state: "not-configured" });
  assert.deepEqual(await listSavedHeatmaps(CFG, [], ok.f), { state: "no-origin" });
});

test("getSavedHeatmap: 404 / hidden / mismatched short ID → not-found", async () => {
  assert.equal((await getSavedHeatmap(CFG, [SITE], "AbC123xy", fakeFetch(() => json(heatmapApi())).f)).state, "ok");
  assert.deepEqual(await getSavedHeatmap(CFG, [SITE], "AbC123xy", fakeFetch(() => json({ detail: "Not found." }, 404)).f), { state: "not-found" });
  assert.deepEqual(await getSavedHeatmap(CFG, [SITE], "AbC123xy", fakeFetch(() => json(heatmapApi({ url: "https://evil.example/" }))).f), { state: "not-found" });
  assert.deepEqual(await getSavedHeatmap(CFG, [SITE], "other", fakeFetch(() => json(heatmapApi())).f), { state: "not-found" });
  const bad = fakeFetch(() => json(heatmapApi()));
  assert.deepEqual(await getSavedHeatmap(CFG, [SITE], "../../x", bad.f), { state: "not-found" });
  assert.equal(bad.calls.length, 0, "invalid IDs never reach PostHog");
});

test("widths: parse/validate and pick the closest ready render", () => {
  assert.equal(parseWidth("1024"), 1024);
  for (const bad of ["99", "3001", "12.5", "1e3", "", "abc", "-500", "01024"]) assert.equal(parseWidth(bad), null, bad);
  const h = parseSavedHeatmap(heatmapApi(), [SITE])!;
  assert.equal(chooseWidth(h, null), 1024);
  assert.equal(chooseWidth(h, 1440), 1024, "1440 not rendered yet → closest ready");
  assert.equal(chooseWidth(h, 400), 375);
  assert.equal(chooseWidth({ ...h, readyWidths: [] }, 1024), null);
});

// ── screenshot fetch + proxy ─────────────────────────────────────────────────
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const image = (type = "image/jpeg", extra: Record<string, string> = {}) =>
  new Response(JPEG, { status: 200, headers: { "Content-Type": type, "Content-Length": String(JPEG.byteLength), "Set-Cookie": "upstream=1", Server: "posthog", ...extra } });

test("fetchScreenshot: image / 202 processing / scope / wrong type / oversize", async () => {
  const f = fakeFetch(() => image());
  const ok = await fetchScreenshot(CFG, H_ID, 1024, f.f);
  assert.equal(ok.kind, "image");
  assert.equal(f.calls[0].url, `${POSTHOG_EU_APP_HOST}/api/projects/4242/heatmap_screenshots/${H_ID}/content/?width=1024`);
  assert.equal(f.calls[0].init.cache, "no-store");
  assert.equal((await fetchScreenshot(CFG, H_ID, 1024, fakeFetch(() => json(heatmapApi({ status: "processing" }), 202)).f)).kind, "processing");
  assert.equal((await fetchScreenshot(CFG, H_ID, 1024, fakeFetch(() => scope403("heatmap:read")).f)).kind, "missing-scope");
  assert.equal((await fetchScreenshot(CFG, H_ID, 1024, fakeFetch(() => json({}, 401)).f)).kind, "rejected");
  assert.equal((await fetchScreenshot(CFG, H_ID, 1024, fakeFetch(() => image("text/html")).f)).kind, "failed");
  assert.equal((await fetchScreenshot(CFG, H_ID, 1024, fakeFetch(() => image("image/svg+xml")).f)).kind, "failed");
  assert.equal((await fetchScreenshot(CFG, H_ID, 1024, fakeFetch(() => image("image/jpeg", { "Content-Length": String(MAX_SCREENSHOT_BYTES + 1) })).f)).kind, "failed");
  const none = fakeFetch(() => image());
  assert.equal((await fetchScreenshot(CFG, "nope", 1024, none.f)).kind, "failed");
  assert.equal((await fetchScreenshot(CFG, H_ID, 50, none.f)).kind, "failed");
  assert.equal(none.calls.length, 0);
});

test("limitStream errors past the byte cap", async () => {
  const src = new Response(new Uint8Array(10)).body!;
  await assert.rejects(new Response(limitStream(src, 5)).arrayBuffer());
  const ok = await new Response(limitStream(new Response(new Uint8Array(5)).body!, 5)).arrayBuffer();
  assert.equal(ok.byteLength, 5);
});

function proxyDeps(over: Partial<{ detail: HeatmapDetail; shot: ScreenshotResult; deny: boolean }> = {}) {
  const log: string[] = [];
  const heatmap = parseSavedHeatmap(heatmapApi(), [SITE]) as SavedHeatmap;
  return {
    log,
    deps: {
      authorize: async () => {
        log.push("authorize");
        if (over.deny) throw new Error("NEXT_REDIRECT");
      },
      getHeatmap: async (id: string) => {
        log.push(`heatmap:${id}`);
        return over.detail ?? ({ state: "ok", heatmap } as HeatmapDetail);
      },
      getScreenshot: async (id: string, w: number) => {
        log.push(`shot:${id}:${w}`);
        return over.shot ?? ({ kind: "image", contentType: "image/jpeg", body: new Response(JPEG).body!, length: JPEG.byteLength } as ScreenshotResult);
      },
    },
  };
}

test("proxy: authorization runs first and a denial propagates before any provider call", async () => {
  const { deps, log } = proxyDeps({ deny: true });
  await assert.rejects(screenshotProxy({ shortId: "AbC123xy", width: "1024" }, deps), /NEXT_REDIRECT/);
  assert.deepEqual(log, ["authorize"]);
  const bad = proxyDeps({ deny: true });
  await assert.rejects(screenshotProxy({ shortId: "../../etc", width: "abc" }, bad.deps), /NEXT_REDIRECT/, "auth before validation");
});

test("proxy: validation, 404 for hidden, 202 processing, generic provider errors", async () => {
  for (const input of [
    { shortId: "../x", width: "1024" },
    { shortId: "AbC123xy", width: "50" },
    { shortId: "AbC123xy", width: "1024px" },
    { shortId: undefined, width: null },
  ]) {
    const { deps, log } = proxyDeps();
    const r = await screenshotProxy(input, deps);
    assert.equal(r.status, 400, JSON.stringify(input));
    assert.deepEqual(log, ["authorize"]);
  }
  const nf = await screenshotProxy({ shortId: "AbC123xy", width: null }, proxyDeps({ detail: { state: "not-found" } }).deps);
  assert.equal(nf.status, 404);
  const heat = parseSavedHeatmap(heatmapApi({ status: "processing", snapshots: [] }), [SITE])!;
  const proc = await screenshotProxy({ shortId: "AbC123xy", width: null }, proxyDeps({ detail: { state: "ok", heatmap: heat } }).deps);
  assert.equal(proc.status, 202);
  assert.deepEqual(await proc.json(), { error: "processing" });
  const p202 = await screenshotProxy({ shortId: "AbC123xy", width: "1024" }, proxyDeps({ shot: { kind: "processing" } }).deps);
  assert.equal(p202.status, 202);
  const scope = await screenshotProxy({ shortId: "AbC123xy", width: "1024" }, proxyDeps({ detail: { state: "missing-scope" } }).deps);
  assert.equal(scope.status, 502);
  assert.deepEqual(await scope.json(), { error: "missing heatmap:read scope" });
  for (const r of [nf, scope]) {
    assert.equal(r.headers.get("cache-control"), "private, no-store");
    assert.equal(r.headers.get("authorization"), null);
  }
  const failed = await screenshotProxy({ shortId: "AbC123xy", width: "1024" }, proxyDeps({ shot: { kind: "failed" } }).deps);
  const body = await failed.text();
  assert.equal(failed.status, 502);
  assert.equal(body, JSON.stringify({ error: "unavailable" }));
  assert.ok(!body.includes(KEY) && !body.includes("phx_"));
});

test("proxy: streams the image with private cache and only our own headers", async () => {
  const { deps, log } = proxyDeps();
  const r = await screenshotProxy({ shortId: "AbC123xy", width: "1440" }, deps);
  assert.equal(r.status, 200);
  assert.deepEqual(log, ["authorize", "heatmap:AbC123xy", `shot:${H_ID}:1024`], "closest ready width");
  assert.equal(r.headers.get("content-type"), "image/jpeg");
  assert.equal(r.headers.get("cache-control"), "private, max-age=300");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.equal(r.headers.get("cross-origin-resource-policy"), "same-origin");
  for (const h of ["authorization", "set-cookie", "server", "www-authenticate"]) assert.equal(r.headers.get(h), null, h);
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), JPEG);
  // End-to-end with the real fetchScreenshot: upstream headers are not forwarded.
  const up = fakeFetch(() => image());
  const shot = await fetchScreenshot(CFG, H_ID, 1024, up.f);
  const r2 = await screenshotProxy({ shortId: "AbC123xy", width: null }, { ...deps, getScreenshot: async () => shot });
  assert.equal(r2.headers.get("set-cookie"), null);
  assert.equal(r2.headers.get("server"), null);
  assert.equal((up.calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`, "bearer only upstream");
});

// ── source boundaries ────────────────────────────────────────────────────────
test("source boundaries: super-admin gates, server-only key, no client SDK, read-only scopes", () => {
  const page = read("app/admin/analytics/page.tsx");
  const viewer = read("app/admin/analytics/heatmaps/[shortId]/page.tsx");
  const route = read("app/admin/analytics/heatmaps/[shortId]/screenshot/route.ts");
  for (const [name, src, loader] of [
    ["page", page, "getAnalyticsDashboard("],
    ["viewer", viewer, "getHeatmap("],
  ] as const) {
    assert.match(src, /await requireSuperAdmin\(\);/, name);
    assert.ok(src.indexOf("await requireSuperAdmin()") < src.indexOf(loader), `${name}: authorize before loading`);
    assert.doesNotMatch(src, /^"use client"/m, name);
  }
  assert.match(route, /authorize: requireSuperAdmin/);
  assert.match(read("lib/analytics/heatmap-proxy.ts"), /\/\/ Not wrapped in try[^\n]*\n\s+await deps\.authorize\(\);\n\n\s+if \(!isShortId/);
  assert.match(read("lib/auth.ts"), /export async function requireSuperAdmin\(\): Promise<ProfileRow> \{\n\s+const access = await requireAdminAccess\(\);\n\s+if \(!access\.isSuper\) redirect\("\/admin"\);/);

  const adminFiles = [...files("app/admin"), ...files("components/admin")];
  for (const f of adminFiles) {
    const s = read(f);
    assert.doesNotMatch(s, /posthog-js|@vercel\/analytics|components\/analytics\/|AnalyticsProvider|<iframe/, f);
    assert.doesNotMatch(s, /supadmin\/01/, f);
  }
  // Client components get serialized data only: no lib/data, no lib/analytics modules, no env.
  for (const f of ["components/admin/analytics/charts.tsx", "components/admin/analytics/heatmap-image.tsx"]) {
    const s = read(f);
    assert.match(s, /^"use client";/, f);
    assert.doesNotMatch(s, /lib\/data|lib\/analytics|process\.env|fetch\(|setInterval|setTimeout/, f);
  }
  const loader = read("lib/data/analytics-dashboard.ts");
  assert.match(loader, /^import "server-only";/);
  for (const f of [...files("app"), ...files("components"), ...files("lib")]) {
    if (f === "lib/data/analytics-dashboard.ts" || f.endsWith(".test.ts")) continue;
    assert.doesNotMatch(read(f), /process\.env\.POSTHOG_(PERSONAL_API_KEY|PROJECT_ID)|NEXT_PUBLIC_POSTHOG_(PERSONAL|PROJECT_ID)/, f);
  }
  for (const f of files("components")) assert.doesNotMatch(read(f), /lib\/data\/analytics-dashboard/, f);
  for (const f of ["lib/analytics/dashboard.ts", "lib/analytics/heatmaps.ts", "lib/analytics/heatmap-proxy.ts"]) {
    const s = read(f);
    assert.doesNotMatch(s, /NEXT_PUBLIC_POSTHOG|console\./, f);
  }
  // Read-only heatmap use: no create/update/regenerate/capture calls, no write scopes.
  const hm = read("lib/analytics/heatmaps.ts");
  assert.doesNotMatch(hm, /method: "(POST|PATCH|PUT|DELETE)"|regenerate\/|\/capture\/|\/prewarm\/|\/heatmaps\/\?/);
  for (const f of [...files("app"), ...files("components"), ...files("lib")]) {
    if (f.endsWith(".test.ts")) continue;
    assert.doesNotMatch(read(f), /heatmap:write|session_recording:read|person:read/, f);
  }
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies.recharts, "3.10.1", "exact pin");
  assert.match(pkg.dependencies["react-is"], /^\d+\.\d+\.\d+$/);
  // No client polling / auto refresh on the dashboard.
  for (const f of [...files("app/admin/analytics"), ...files("components/admin/analytics")]) {
    assert.doesNotMatch(read(f), /setInterval|router\.refresh|revalidate = 0|<meta http-equiv="refresh"/, f);
  }
  assert.doesNotMatch(page, /export const dynamic = "force-dynamic"/, "page must not force no-store (the 60 s cache applies)");
});

test("charts are authored: tokens only, no stock Recharts palette or default legend", () => {
  const charts = read("components/admin/analytics/charts.tsx");
  assert.doesNotMatch(charts, /#[0-9a-fA-F]{3,8}\b|\b(Legend|Pie|RadialBar)\b/);
  assert.doesNotMatch(charts, /#8884d8|#82ca9d|rgb\(136/);
  assert.match(charts, /var\(--brand\)/);
  assert.match(charts, /content=\{\(p: TipProps\)/);
});
