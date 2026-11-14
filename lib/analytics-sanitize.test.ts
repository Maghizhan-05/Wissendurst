// Unit tests — run with `npm run test:unit` (node --test, no build step).
// D-024: every PostHog event passes the pre-send sanitizer — event allowlist,
// property allowlist, PII rejection and pathname-only URLs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOM_EVENTS,
  isPiiKeyName,
  isPiiShaped,
  parseElementsChain,
  sanitizeElementsChain,
  sanitizeEvent,
  sanitizeHref,
  sanitizeUrl,
} from "./analytics/sanitize.ts";
import { registrationProps } from "./analytics/events.ts";

const origin = "https://wissendurst27.vercel.app";
const ctx = (pathname: string) => ({ origin, pathname });
const base = {
  token: "phc_" + "A1b2C3d4".repeat(5),
  distinct_id: "019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5b",
  $device_id: "019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5b",
  $session_id: "019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5c",
  $lib: "web",
  $lib_version: "1.449.2",
  $browser: "Chrome",
  $os: "Linux",
  $current_url: `${origin}/events/robotics?utm_source=x&email=a@b.co#frag`,
  $pathname: "/events/robotics",
  $host: "wissendurst27.vercel.app",
  $referrer: "https://google.com/search?q=me",
  $referring_domain: "google.com",
  $raw_user_agent: "Mozilla/5.0",
  $initial_referrer: "https://x.test",
  $title: "Robotics — Wissendurst",
};

test("only the approved events are sent", () => {
  for (const e of ["$pageview", "$pageleave", "$autocapture", ...CUSTOM_EVENTS]) {
    const props = e === "$autocapture" ? { ...base, $event_type: "click" } : base;
    assert.ok(sanitizeEvent({ event: e, properties: props }, ctx("/events/robotics")), e);
  }
  for (const e of ["$identify", "$set", "$exception", "$opt_in", "$rageclick", "$dead_click", "$web_vitals", "$feature_flag_called", "$groupidentify", "payment_confirmed", "custom"]) {
    assert.equal(sanitizeEvent({ event: e, properties: base }, ctx("/")), null, e);
  }
});

test("nothing is sent while the current page is not an approved route", () => {
  for (const p of ["/dashboard", "/dashboard/payment/x", "/admin", "/login", "/application", "/blocked"]) {
    assert.equal(sanitizeEvent({ event: "$pageview", properties: base }, ctx(p)), null, p);
    assert.equal(sanitizeEvent({ event: "consent_granted", properties: {} }, ctx(p)), null, p);
  }
});

test("URLs become same-origin pathnames; referrer, title, UA and unknown keys are removed", () => {
  const out = sanitizeEvent({ event: "$pageview", properties: { ...base, email: "a@b.co", custom: 1 } }, ctx("/events/robotics"))!;
  assert.equal(out.properties!.$current_url, `${origin}/events/robotics`);
  assert.equal(out.properties!.$pathname, "/events/robotics");
  for (const k of ["$referrer", "$referring_domain", "$raw_user_agent", "$initial_referrer", "$title", "email", "custom"]) {
    assert.ok(!(k in out.properties!), k);
  }
  // PostHog's own anonymous ids survive (UUID-shaped by design).
  assert.equal(out.properties!.distinct_id, base.distinct_id);
  assert.equal(sanitizeUrl("https://evil.test/events", origin), null);
  assert.equal(sanitizeUrl("/events/x?y=1#z", origin), `${origin}/events/x`);
  assert.equal(sanitizeHref("mailto:a@b.co", origin), null);
  assert.equal(sanitizeHref("tel:+919876543210", origin), null);
  assert.equal(sanitizeHref("/events/x?ref=1", origin), "/events/x");
});

test("person properties are never sent", () => {
  const out = sanitizeEvent(
    { event: "$pageview", properties: base, $set: { email: "a@b.co" }, $set_once: { $initial_referrer: "x" } },
    ctx("/"),
  )!;
  assert.ok(!("$set" in out) && !("$set_once" in out));
});

test("product properties: only slug/category and coarse team info, validated", () => {
  const good = sanitizeEvent(
    {
      event: "registration_started",
      properties: { ...base, event_slug: "robotics", event_category: "technical", team: true, team_size: 3, participant_id: "W27/E/0012" },
    },
    ctx("/events/robotics"),
  )!.properties!;
  assert.equal(good.event_slug, "robotics");
  assert.equal(good.event_category, "technical");
  assert.equal(good.team, true);
  assert.equal(good.team_size, 3);
  assert.ok(!("participant_id" in good));
  const bad = sanitizeEvent(
    {
      event: "free_registration_confirmed",
      properties: { event_slug: "Robotics Club", event_category: "a@b.co", team: "yes", team_size: 50 },
    },
    ctx("/events/robotics"),
  )!.properties!;
  for (const k of ["event_slug", "event_category", "team", "team_size"]) assert.ok(!(k in bad), k);
  // product props on system events are not allowed
  assert.ok(!("event_slug" in sanitizeEvent({ event: "$pageview", properties: { event_slug: "x" } }, ctx("/"))!.properties!));
  assert.deepEqual(sanitizeEvent({ event: "consent_granted", properties: { event_slug: "x", reason: "y" } }, ctx("/"))!.properties, {});
});

test("typed registration props are coarse", () => {
  assert.deepEqual(registrationProps({ slug: "robotics", category: "technical" }), {
    event_slug: "robotics",
    event_category: "technical",
    team: false,
  });
  assert.deepEqual(registrationProps({ slug: "robotics", category: null, teamSize: 4 }), {
    event_slug: "robotics",
    team: true,
    team_size: 4,
  });
  assert.equal(registrationProps({ slug: "robotics", teamSize: 99 }).team_size, 10);
  assert.equal(registrationProps({ slug: "Bad Slug!" }).event_slug, "unknown");
});

test("PII-shaped values and names are recognized", () => {
  for (const v of [
    "someone@college.edu",
    "+91 98765 43210",
    "9876543210",
    "W27/E/0042",
    "W27/GR/0007",
    "supadmin/01",
    "3f2a6c1e-7b4d-4c2a-9e1f-0a1b2c3d4e5f",
    "UTR 412345678901",
    "412345678901",
    "id-card.png",
    "screenshot.JPEG",
    "https://abc.supabase.co/storage/v1/object/sign/x",
    "TypeError: Cannot read properties of undefined",
    "name@okhdfcbank",
  ]) {
    assert.ok(isPiiShaped(v), v);
  }
  for (const v of ["Chrome", "Linux", "1.449.2", "web", "Asia/Kolkata", "robotics-2-0", "Desktop"]) {
    assert.ok(!isPiiShaped(v), v);
  }
  for (const k of ["email", "user_email", "phone", "full_name", "utr", "transaction_id", "participant_id", "file_name", "error_message", "upi"]) {
    assert.ok(isPiiKeyName(k), k);
  }
  for (const k of ["event_slug", "team", "team_size"]) assert.ok(!isPiiKeyName(k), k);
});

test("system string values with PII shapes are removed", () => {
  const out = sanitizeEvent({ event: "$pageview", properties: { ...base, $os: "a@b.co", $browser: "W27/E/0001" } }, ctx("/"))!;
  assert.ok(!("$os" in out.properties!) && !("$browser" in out.properties!));
});

test("autocapture: click/submit only; elements keep tag/class/nth and same-origin paths", () => {
  assert.equal(sanitizeEvent({ event: "$autocapture", properties: { ...base, $event_type: "change" } }, ctx("/")), null);
  const out: Record<string, unknown> = sanitizeEvent(
    {
      event: "$autocapture",
      properties: {
        ...base,
        $event_type: "click",
        $el_text: "Dr. Kavitha 98400 12345",
        $external_click_url: "https://wa.me/919999999999",
        $elements: [
          {
            tag_name: "a",
            $el_text: "Register",
            attr__href: "/events/robotics?ref=someone@x.co",
            attr__class: "btn btn-primary",
            attr__id: "user-3f2a6c1e",
            "attr__aria-label": "Call Dr Kavitha",
            "attr__data-email": "a@b.co",
            nth_child: 2,
            nth_of_type: 1,
          },
          { tag_name: "a", attr__href: "mailto:a@b.co" },
          { tag_name: "<script>" },
        ],
        $elements_chain:
          'a.btn.btn-primary:attr__class="btn btn-primary"attr__href="/events/robotics?ref=a@b.co"attr__id="u1"href="/events/robotics?ref=a@b.co"nth-child="2"nth-of-type="1"text="Dr Kavitha \\"x\\" 9840012345";div.ph-wrap:nth-child="1"nth-of-type="1"',
      },
    },
    ctx("/events/robotics"),
  )!.properties!;
  assert.ok(!("$el_text" in out) && !("$external_click_url" in out));
  assert.deepEqual(out.$elements, [
    { tag_name: "a", nth_child: 2, nth_of_type: 1, attr__class: "btn btn-primary", attr__href: "/events/robotics" },
    { tag_name: "a" },
  ]);
  assert.equal(
    out.$elements_chain,
    'a.btn.btn-primary:attr__class="btn btn-primary"attr__href="/events/robotics"href="/events/robotics"nth-child="2"nth-of-type="1";div.ph-wrap:nth-child="1"nth-of-type="1"',
  );
  assert.equal(parseElementsChain('a:href="unterminated'), null);
  assert.equal(sanitizeElementsChain("not a chain", origin), null);
});

test("heatmap and replay URLs are reduced; other pages' data is dropped", () => {
  const hm = sanitizeEvent(
    {
      event: "$$heatmap",
      properties: {
        ...base,
        $heatmap_data: {
          [`${origin}/events/robotics?x=1`]: [{ x: 1, y: 2, target_fixed: false, type: "click", note: "a@b.co" }],
          [`${origin}/dashboard/payment/abc`]: [{ x: 1, y: 2, type: "click" }],
        },
      },
    },
    ctx("/events/robotics"),
  )!.properties!;
  assert.deepEqual(hm.$heatmap_data, { [`${origin}/events/robotics`]: [{ x: 1, y: 2, target_fixed: false, type: "click" }] });

  const snap = sanitizeEvent(
    {
      event: "$snapshot",
      properties: {
        ...base,
        $snapshot_bytes: 10,
        $snapshot_data: [
          { type: 4, data: { href: `${origin}/events/robotics?token=x#y`, width: 1, height: 1 } },
          { type: 4, data: { href: `${origin}/admin` } },
          { type: 3, data: { source: 1 } },
        ],
      },
    },
    ctx("/events/robotics"),
  )!.properties!;
  assert.deepEqual(snap.$snapshot_data, [
    { type: 4, data: { href: `${origin}/events/robotics`, width: 1, height: 1 } },
    { type: 3, data: { source: 1 } },
  ]);
});
