import { test } from "node:test";
import assert from "node:assert/strict";
import { backgroundsCss, backgroundsSchema, mergeBackgrounds, sniffImageType, DEFAULT_BACKGROUNDS } from "./backgrounds.ts";

const URL = "https://abc.supabase.co";

test("no image means no CSS (original look kept)", () => {
  assert.equal(backgroundsCss({}, URL), "");
  assert.equal(backgroundsCss({ light: "backgrounds/a.png" }, undefined), "");
});

test("per-theme rules with controls", () => {
  const css = backgroundsCss({ dark: "backgrounds/d-1.webp", opacity: 40, overlay_strength: 20, overlay_color: "#102030", size: "contain", position: "top", repeat: true }, URL);
  assert.ok(css.startsWith('html.dark .site-bg{display:block;background-image:url("https://abc.supabase.co/storage/v1/object/public/site-images/backgrounds/d-1.webp")'));
  assert.match(css, /background-position:top;background-size:contain;background-repeat:repeat;opacity:0\.4/);
  assert.match(css, /background:#102030;opacity:0\.2/);
  assert.ok(!css.includes("html:root:not(.dark)"));
});

test("hostile stored values never reach CSS", () => {
  const css = backgroundsCss({ light: 'backgrounds/x.png");}body{display:none', position: "0 0;color:red", opacity: 1000 }, URL);
  assert.equal(css, "");
  const m = mergeBackgrounds({ position: "left", size: "100%", overlay_color: "red", repeat: "yes" });
  assert.deepEqual(m, DEFAULT_BACKGROUNDS);
  assert.equal(backgroundsCss({ light: "backgrounds/a.png" }, "javascript:alert(1)"), "");
});

test("save schema", () => {
  assert.equal(backgroundsSchema.safeParse(DEFAULT_BACKGROUNDS).success, true);
  assert.equal(backgroundsSchema.safeParse({ ...DEFAULT_BACKGROUNDS, light: "../x.png" }).success, false);
  assert.equal(backgroundsSchema.safeParse({ ...DEFAULT_BACKGROUNDS, opacity: 3 }).success, false);
  assert.equal(backgroundsSchema.safeParse({ ...DEFAULT_BACKGROUNDS, extra: 1 }).success, false);
});

test("image sniffing", () => {
  assert.equal(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImageType(new TextEncoder().encode("RIFF1234WEBPVP8 ")), "image/webp");
  assert.equal(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>")), null);
});
