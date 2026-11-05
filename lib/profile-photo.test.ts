// Unit tests — run with `npm run test:unit` (node --test, no build step).
import { test } from "node:test";
import assert from "node:assert/strict";
import { profilePhotoUrl } from "./profile-photo.ts";

test("profile photo URLs are always built on the configured Supabase origin", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co/";
  const uid = "00000000-0000-0000-0000-000000000701";
  assert.equal(
    profilePhotoUrl(`${uid}/avatar-1.png`),
    `https://proj.supabase.co/storage/v1/object/public/profile-images/${uid}/avatar-1.png`,
  );
  for (const bad of [
    "https://evil.example/storage/v1/object/public/profile-images/" + uid + "/a.png",
    `${uid}/../x.png`,
    `${uid}/sub/x.png`,
    "javascript:alert(1)",
    "",
    null,
    undefined,
  ])
    assert.equal(profilePhotoUrl(bad), null, String(bad));
});
