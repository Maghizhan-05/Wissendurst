import { test } from "node:test";
import assert from "node:assert/strict";
import { enabledSocialLinks, mergeSocial, socialLinkError, socialSchema } from "./social.ts";

test("social links: https only, per-platform hosts, no script URLs", () => {
  assert.equal(socialLinkError("instagram", "https://www.instagram.com/wissendurst27"), null);
  assert.equal(socialLinkError("x", "https://twitter.com/w27"), null);
  assert.equal(socialLinkError("whatsapp", "https://chat.whatsapp.com/AbC123"), null);
  assert.equal(socialLinkError("website", "https://wissendurst27.vercel.app/about"), null);
  assert.equal(socialLinkError("facebook", "http://facebook.com/x"), "Use a secure link that starts with https://");
  assert.equal(socialLinkError("website", "javascript:alert(1)"), "Enter a full https:// web address");
  assert.equal(socialLinkError("x", "https://instagram.com/x"), "X (Twitter) links must be on x.com or twitter.com");
  assert.equal(socialLinkError("instagram", "https://instagram.com.evil.io/x"), "Instagram links must be on instagram.com");
  assert.equal(socialLinkError("website", "https://localhost/x"), "Enter a full https:// web address");
  assert.equal(socialLinkError("website", "https://a.org/<script>"), "Enter a full https:// web address");
  assert.equal(socialLinkError("website", ""), "Enter the link");
});

test("social settings: at most five, strict keys, malformed stored data is dropped", () => {
  const link = { platform: "website", url: "https://a.org", enabled: true } as const;
  assert.equal(socialSchema.safeParse({ links: Array(5).fill(link) }).success, true);
  assert.equal(socialSchema.safeParse({ links: Array(6).fill(link) }).success, false);
  assert.equal(socialSchema.safeParse({ links: [], extra: 1 }).success, false);
  assert.equal(socialSchema.safeParse({ links: [{ ...link, platform: "tiktok" }] }).success, false);
  assert.deepEqual(mergeSocial({ links: [{ platform: "x", url: "http://x.com", enabled: true }] }), { links: [] });
  assert.deepEqual(mergeSocial(null), { links: [] });
  const s = mergeSocial({
    links: [
      { platform: "instagram", url: "https://instagram.com/w", enabled: true },
      { platform: "x", url: "https://x.com/w", enabled: false },
    ],
  });
  assert.deepEqual(enabledSocialLinks(s).map((l) => l.platform), ["instagram"]);
});
