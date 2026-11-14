// Unit tests — run with `npm run test:unit` (node --test, no build step).
// D-024: route policy. PostHog may operate on exactly six public routes; every
// route in the app tree is enumerated from the filesystem and checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { autocaptureUrlAllowlist, eventSlugFromPath, isAnalyticsRoute, normalizePathname } from "./analytics/routes.ts";

const ROOT = new URL("../", import.meta.url).pathname;

/** Every page/route in app/ as a URL pattern (route groups removed). */
function appRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string, segs: string[]) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full, /^\(.*\)$/.test(name) ? segs : [...segs, name]);
      } else if (/^(page|route)\.tsx?$/.test(name)) {
        out.push("/" + segs.join("/"));
      }
    }
  };
  walk(join(ROOT, "app"), []);
  return [...new Set(out)].sort();
}

/** A concrete path for a pattern ([slug] → valid slug, [id] → UUID). */
function sample(pattern: string): string {
  return pattern
    .replace(/\[slug\]/g, "robotics-challenge")
    .replace(/\[\.\.\.[^\]]+\]/g, "a/b")
    .replace(/\[[^\]]+\]/g, "3f2a6c1e-7b4d-4c2a-9e1f-0a1b2c3d4e5f");
}

const ALLOWED_PATTERNS = ["/", "/events", "/events/[slug]", "/about", "/schedule", "/general-registration"];

test("of all app routes, exactly the six approved public routes allow analytics", () => {
  const routes = appRoutes();
  assert.ok(routes.length > 30, `found ${routes.length} routes`);
  const allowed = routes.filter((r) => isAnalyticsRoute(sample(r)));
  assert.deepEqual(allowed.sort(), [...ALLOWED_PATTERNS].sort());
  for (const p of ALLOWED_PATTERNS) assert.ok(routes.includes(p), `${p} exists`);
});

test("every sensitive area is denied, including children and lookalikes", () => {
  for (const p of [
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/auth/callback",
    "/application",
    "/pending-approval",
    "/blocked",
    "/dashboard",
    "/dashboard/payment/3f2a6c1e-7b4d-4c2a-9e1f-0a1b2c3d4e5f",
    "/dashboard/profile",
    "/dashboard/registrations",
    "/admin",
    "/admin/users/3f2a6c1e-7b4d-4c2a-9e1f-0a1b2c3d4e5f",
    "/admin/events/x/edit",
    "/events/robotics/register",
    "/events/Robotics",
    "/events/a--b",
    "/events//x",
    "/eventsx",
    "/about/team",
    "/schedule/2027",
    "/general-registration/pay",
    "//evil.test/",
    "/events/x?y=1",
    "/events/x#h",
    "/events/%2e%2e",
    "",
    "events",
  ]) {
    assert.equal(isAnalyticsRoute(p), false, p);
  }
});

test("allowed paths, trailing slashes and slug extraction", () => {
  for (const p of ["/", "/events", "/events/", "/about", "/schedule/", "/general-registration", "/events/robotics-2-0"]) {
    assert.equal(isAnalyticsRoute(p), true, p);
  }
  assert.equal(normalizePathname("/events/"), "/events");
  assert.equal(eventSlugFromPath("/events/robotics-2-0"), "robotics-2-0");
  assert.equal(eventSlugFromPath("/events"), null);
  assert.equal(eventSlugFromPath("/dashboard/robotics"), null);
});

test("autocapture URL allowlist is same-origin and matches only the approved routes", () => {
  const origin = "https://wissendurst27.vercel.app";
  const list = autocaptureUrlAllowlist(origin);
  const ok = (u: string) => list.some((r) => r.test(u));
  for (const u of ["/", "/events", "/events/robotics", "/about", "/schedule", "/general-registration"]) {
    assert.ok(ok(origin + u), u);
  }
  for (const u of ["/dashboard", "/admin", "/login", "/events/x/y", "/events?x=1"]) assert.ok(!ok(origin + u), u);
  assert.ok(!ok("https://evil.test/events"));
  assert.ok(!ok("https://wissendurst27xvercel.app/events"));
});
