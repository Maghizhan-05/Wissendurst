// Unit tests — run with `npm run test:unit` (node --test, no build step).
// D-024: source boundaries (PostHog never in sensitive route trees), the
// privacy configuration, replay masking and inert-without-token wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { buildPostHogConfig } from "./analytics/posthog-options.ts";
import {
  REPLAY_BLOCK_SELECTOR,
  maskReplayAttribute,
  maskReplayInput,
  maskReplayText,
  replayTextAllowed,
} from "./analytics/privacy.ts";

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

/** Imports/calls that mean "analytics runs here". */
const ANALYTICS_USE = /posthog|components\/analytics|analytics-provider|posthog-runtime|\btrack\(/i;

test("no PostHog import or call in any sensitive route tree, action or server code", () => {
  const sensitive = [
    "app/(auth)",
    "app/auth",
    "app/application",
    "app/pending-approval",
    "app/blocked",
    "app/dashboard",
    "app/admin",
    "components/admin",
    "components/auth",
    "components/dashboard",
    "components/payment",
    "lib/actions",
    "lib/data",
    "lib/email",
    "lib/supabase",
    "supabase",
  ];
  for (const dir of sensitive) {
    let list: string[] = [];
    try {
      list = files(dir);
    } catch {
      continue; // directory may not exist
    }
    for (const f of list) assert.doesNotMatch(read(f), ANALYTICS_USE, f);
  }
  assert.doesNotMatch(read("proxy.ts"), /posthog|analytics/i, "proxy.ts untouched");
  assert.doesNotMatch(read("app/layout.tsx"), ANALYTICS_USE, "root layout never mounts analytics");
});

test("only the runtime imports the SDK, via the bundled no-external entry, loaded dynamically", () => {
  const importers = [...files("app"), ...files("components"), ...files("lib")].filter(
    (f) => !f.endsWith(".test.ts") && /from\s+["']posthog-js/.test(read(f)),
  );
  assert.deepEqual(importers.sort(), ["components/analytics/posthog-runtime.ts", "lib/analytics/posthog-options.ts"]);
  assert.match(read("components/analytics/posthog-runtime.ts"), /import posthog from "posthog-js\/dist\/module\.full\.no-external";/);
  assert.match(read("lib/analytics/posthog-options.ts"), /^import type \{ PostHogConfig \} from "posthog-js\/dist\/module\.full\.no-external";/m);
  const provider = read("components/analytics/analytics-provider.tsx");
  assert.match(provider, /import\("\.\/posthog-runtime"\)/);
  assert.doesNotMatch(provider, /from ["']\.\/posthog-runtime["']/, "never a static import");
  assert.doesNotMatch(provider, /posthog-js/);
  assert.doesNotMatch(read("components/analytics/bridge.ts"), /posthog-js|posthog-runtime"/);
  for (const f of files("components").filter((f) => !f.startsWith("components/analytics/"))) {
    assert.doesNotMatch(read(f), /posthog-runtime|posthog-js/, f);
  }
  for (const f of ["components/analytics/posthog-runtime.ts", "components/analytics/bridge.ts"]) {
    assert.doesNotMatch(read(f), /\.identify\(|\.alias\(|\.group\(|\.register\(|\.setPersonProperties/, f);
  }
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.dependencies["posthog-js"], /^\d+\.\d+\.\d+$/, "exact version pin");
});

test("public layout mounts the provider only with a configured token; footer control is inert without it", () => {
  const layout = read("app/(public)/layout.tsx");
  assert.match(layout, /const analyticsToken = configuredProjectToken\(\);\n\s+if \(!analyticsToken\) return page;/);
  assert.match(layout, /headersSignalDenial\(/);
  assert.match(read("components/analytics/cookie-preferences-button.tsx"), /if \(!ctx\) return null;/);
  assert.match(read("components/layout/footer.tsx"), /<CookiePreferencesButton \/>/);
  const provider = read("components/analytics/analytics-provider.tsx");
  assert.match(provider, /const showBanner = pathname === "\/" && consent\.state === "unknown";/);
  assert.match(provider, /if \(serverSignal \|\| liveSignal\(\)\) return; \/\/ the browser signal always wins/);
  assert.match(read("lib/analytics/config.ts"), /process\.env\.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN/);
  for (const f of [".env.example"]) {
    try {
      const env = read(f);
      assert.match(env, /^NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=$/m, `${f} documents an EMPTY token`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
});

test("withdrawal resets identity and opts out; capture is suspended off approved routes", () => {
  const rt = read("components/analytics/posthog-runtime.ts");
  const revoke = rt.slice(rt.indexOf("revoke() {"));
  assert.ok(
    revoke.indexOf("stopSessionRecording()") < revoke.indexOf("reset(true)") &&
      revoke.indexOf("reset(true)") < revoke.indexOf("opt_out_capturing()"),
    "stop → reset → opt out",
  );
  assert.match(rt.slice(rt.indexOf("suspend() {")), /suspended = true;\s+if \(initialized\) posthog\.stopSessionRecording\(\);/);
  const provider = read("components/analytics/analytics-provider.tsx");
  assert.match(provider, /if \(!granted \|\| !routeAllowed\) \{\s+bridge\.runtime\?\.suspend\(\);/);
});

const guards = { origin: "https://wissendurst27.vercel.app", pathname: () => "/events/robotics", mayCapture: () => true };

test("configuration: EU host, anonymous, consent-first, features disabled", () => {
  const c = buildPostHogConfig(guards);
  assert.equal(c.api_host, "https://eu.i.posthog.com");
  assert.equal(c.person_profiles, "identified_only");
  assert.equal(c.opt_out_capturing_by_default, true);
  assert.equal(c.opt_out_persistence_by_default, true);
  assert.equal(c.internal_or_test_user_hostname, null, "no person processing via test-user tagging");
  for (const k of [
    "advanced_disable_feature_flags",
    "advanced_disable_feature_flags_on_first_load",
    "disable_surveys",
    "disable_product_tours",
    "disable_conversations",
    "disable_web_experiments",
    "disable_external_dependency_loading",
    "disable_capture_url_hashes",
    "mask_all_text",
  ] as const) {
    assert.equal(c[k], true, k);
  }
  for (const k of [
    "capture_exceptions",
    "capture_performance",
    "capture_dead_clicks",
    "rageclick",
    "enable_recording_console_log",
    "opt_in_site_apps",
    "save_referrer",
    "save_campaign_params",
  ] as const) {
    assert.equal(c[k], false, k);
  }
  assert.equal(c.capture_pageview, "history_change");
  assert.equal(c.capture_pageleave, true);
  assert.equal(c.capture_heatmaps, true);
  assert.equal(c.disable_scroll_properties, false);
  assert.equal(c.get_current_url!("https://wissendurst27.vercel.app/events/robotics?x=1#y"), "https://wissendurst27.vercel.app/events/robotics");
  const ac = c.autocapture as Exclude<typeof c.autocapture, boolean | undefined>;
  assert.deepEqual(ac.dom_event_allowlist, ["click", "submit"]);
  assert.deepEqual(ac.element_allowlist, ["a", "button", "form", "input", "select"]);
  assert.equal(ac.capture_copied_text, false);
  assert.ok(!ac.capture_value_css_selector_allowlist, "no input values");
  assert.ok(ac.css_selector_ignorelist!.includes(".ph-no-capture"));
});

test("session replay: inputs always masked, no console/network/canvas, media blocked", () => {
  const r = buildPostHogConfig(guards).session_recording!;
  assert.equal(r.maskAllInputs, true);
  assert.ok(Object.values(r.maskInputOptions!).every((v) => v === true));
  assert.equal(Object.keys(r.maskInputOptions!).length, 16);
  assert.equal(r.recordHeaders, false);
  assert.equal(r.recordBody, false);
  assert.equal(r.recordCrossOriginIframes, false);
  assert.deepEqual(r.captureCanvas, { recordCanvas: false });
  assert.equal(r.maskTextSelector, "*");
  assert.equal(r.maskInputFn!("secret@x.co"), "***********");
  assert.equal(r.maskNetworkRequestFn!({ url: "x" } as never), null);
  // The replay page URL (rrweb Meta) is kept as the approved same-origin path only.
  const mask = r.maskCapturedNetworkRequestFn!;
  assert.deepEqual(mask({ name: "https://wissendurst27.vercel.app/events/robotics?utr=1#x" } as never), {
    name: "https://wissendurst27.vercel.app/events/robotics",
  });
  assert.equal(mask({ name: "https://wissendurst27.vercel.app/dashboard/payment/x" } as never), null);
  assert.equal(mask({ name: "https://evil.test/events" } as never), null);
  for (const sel of ["img", "picture", "video", "canvas", "iframe", "[data-qr]", ".ph-no-capture"]) {
    assert.ok(REPLAY_BLOCK_SELECTOR.split(", ").includes(sel), sel);
  }
});

/** Minimal element stand-in for closest(). */
function el(chain: string[]): { closest: (s: string) => unknown } {
  // chain: selectors this element (or an ancestor) matches
  return {
    closest: (sel: string) => sel.split(",").map((s) => s.trim()).some((s) => chain.includes(s)) || null,
  };
}

test("replay text is masked except reviewed copy; blocked regions and inputs never unmask", () => {
  assert.equal(maskReplayText("Dr Kavitha 98400", el([])), "** ******* *****");
  assert.equal(maskReplayText("Robotics Challenge", el(["[data-ph-unmask]"])), "Robotics Challenge");
  assert.equal(maskReplayText("98400 12345", el(["[data-ph-unmask]", ".ph-no-capture"])), "***** *****");
  assert.equal(replayTextAllowed(el(["[data-ph-unmask]", "input"])), false);
  assert.equal(replayTextAllowed(null), false);
  assert.equal(maskReplayInput(""), "");
});

test("replay attributes: URLs reduced to same-origin path, text attributes masked", () => {
  const o = "https://wissendurst27.vercel.app";
  assert.equal(maskReplayAttribute("href", "/events/x?utr=1#y", o), "/events/x");
  assert.equal(maskReplayAttribute("href", "mailto:a@b.co", o), "");
  assert.equal(maskReplayAttribute("href", "https://evil.test/x", o), "");
  assert.equal(maskReplayAttribute("src", "https://abc.supabase.co/storage/v1/object/sign/x.png", o), "");
  assert.equal(maskReplayAttribute("srcset", "/a.png 1x", o), "");
  assert.equal(maskReplayAttribute("aria-label", "Call Dr K", o), "**** ** *");
  assert.equal(maskReplayAttribute("data-email", "a@b.co", o), "******");
  assert.equal(maskReplayAttribute("data-state", "open", o), "open");
  assert.equal(maskReplayAttribute("class", "btn primary", o), "btn primary");
});

test("identity-bearing fragments and contacts carry the PostHog no-capture marker", () => {
  const nav = read("components/layout/navbar.tsx");
  assert.equal(nav.match(/className=\{(?:NO_CAPTURE_CLASS|`\$\{NO_CAPTURE_CLASS\} w-full`)\}[^\n]*\n\s+[^\n]*user\.participantId/g)?.length, 2);
  assert.match(read("components/events/event-coordinators.tsx"), /className=\{NO_CAPTURE_CLASS\}/);
  assert.match(read("components/events/team-register.tsx"), /\$\{NO_CAPTURE_CLASS\} rounded-2xl/);
  assert.match(read("components/layout/footer.tsx"), /\$\{NO_CAPTURE_CLASS\} mt-4 space-y-2/);
  assert.match(read("app/(public)/general-registration/page.tsx"), /aria-labelledby="gr-status-heading" className=\{`\$\{NO_CAPTURE_CLASS\} space-y-6`\}/);
  assert.match(read("components/analytics/consent-panel.tsx"), /\$\{NO_CAPTURE_CLASS\} fixed/);
});

test("only the four typed custom events are emitted, never with payment context", () => {
  const sources = [...files("app"), ...files("components")].map((f) => [f, read(f)] as const);
  const calls = sources.flatMap(([f, s]) => [...s.matchAll(/\btrack\("([a-z_]+)"/g)].map((m) => `${f}:${m[1]}`));
  assert.deepEqual(
    [...new Set(calls)].sort(),
    [
      "components/events/register-cta.tsx:free_registration_confirmed",
      "components/events/register-cta.tsx:registration_started",
      "components/events/team-register.tsx:free_registration_confirmed",
      "components/events/team-register.tsx:registration_started",
    ],
  );
  const rt = read("components/analytics/posthog-runtime.ts");
  assert.deepEqual([...rt.matchAll(/posthog\.capture\("([a-z_]+)"/g)].map((m) => m[1]).sort(), ["consent_denied", "consent_granted"]);
});
