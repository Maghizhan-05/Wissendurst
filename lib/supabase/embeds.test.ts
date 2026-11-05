// Unit tests — run with `npm run test:unit` (node --test, no build step).
// Regression guard: `registrations` has two foreign keys to `events`
// (event_id and offer_source_event_id, 0019), so an unqualified
// `events(...)` embed is ambiguous (PostgREST PGRST201 / HTTP 300).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") ? [p] : [];
  });
}

test("no ambiguous events(...) embeds (always name the foreign key)", () => {
  const offenders: string[] = [];
  for (const dir of ["app", "components", "lib", "supabase/functions"]) {
    let files: string[] = [];
    try {
      files = sources(join(ROOT, dir));
    } catch {
      continue;
    }
    for (const f of files) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          // `<alias>:events(` or a bare `events(` inside a select string, without `!fk`
          if (/(?:[\w]+:|[\s"'`,(])events\(/.test(line) && !/from\(["']events["']\)/.test(line))
            offenders.push(`${f.slice(ROOT.length)}:${i + 1}: ${line.trim()}`);
        });
    }
  }
  assert.deepEqual(offenders, []);
});

test("registration embeds use the event_id relationship", () => {
  const src = ["lib/data/registrations.ts", "lib/data/admin.ts", "lib/actions/payment.ts", "lib/email/notify.ts"]
    .map((f) => readFileSync(join(ROOT, f), "utf8"))
    .join("\n");
  const embeds = src.match(/event:events!?[\w]*\(/g) ?? [];
  assert.ok(embeds.length >= 9, `found ${embeds.length}`);
  for (const e of embeds) assert.equal(e, "event:events!registrations_event_id_fkey(");
});
