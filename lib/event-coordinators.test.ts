// Unit tests — run with `npm run test:unit` (node --test, no build step).
// 0035 / D-023: public event coordinators — shared validation, DB parity and
// the safe rendering helpers used by the public cards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COORDINATOR_EMAIL_PATTERN,
  COORDINATOR_PHONE_PATTERN,
  MAX_COORDINATORS,
  coordinatorsToDrafts,
  mailHref,
  normalizeStoredCoordinators,
  parseCoordinatorsField,
  telHref,
  validateCoordinators,
} from "./events/coordinators.ts";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (f: string) => readFileSync(ROOT + f, "utf8");
const MIGRATION = "supabase/migrations/0035_open_signup_bans_event_contacts.sql";
const row = (o: Partial<Record<"name" | "role" | "phone" | "email", string>>) => ({
  name: "",
  role: "",
  phone: "",
  email: "",
  ...o,
});

test("valid rows: name plus phone and/or email; blanks omitted and whitespace tidied", () => {
  const r = validateCoordinators([
    row({ name: "  Dr. Kavitha  S ", role: "Faculty coordinator", phone: "+91 98400 12345", email: "kavitha@smc.edu.in" }),
    row({ name: "Arjun", phone: "9003177881" }),
    row({ name: "Lakshmi", email: "l@x.in" }),
  ]);
  assert.deepEqual(r, {
    ok: true,
    coordinators: [
      { name: "Dr. Kavitha S", role: "Faculty coordinator", phone: "+91 98400 12345", email: "kavitha@smc.edu.in" },
      { name: "Arjun", phone: "9003177881" },
      { name: "Lakshmi", email: "l@x.in" },
    ],
  });
  assert.deepEqual(validateCoordinators([]), { ok: true, coordinators: [] });
});

test("invalid rows report a per-field reason", () => {
  const r = validateCoordinators([
    row({ name: "No contact" }),
    row({ phone: "9003177881" }),
    row({ name: "A", phone: "call me" }),
    row({ name: "B", email: "b@b" }),
    row({ name: "x".repeat(81), phone: "9003177881" }),
    row({ name: "C", role: "r".repeat(81), email: "c@c.in" }),
  ]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.rowErrors[0].contact);
  assert.ok(r.rowErrors[1].name);
  assert.ok(r.rowErrors[2].phone);
  assert.ok(r.rowErrors[3].email);
  assert.ok(r.rowErrors[4].name);
  assert.ok(r.rowErrors[5].role);
  assert.match(r.error, /^Coordinator 1: /);
});

test("at most ten coordinators", () => {
  const ten = Array.from({ length: MAX_COORDINATORS }, (_, i) => row({ name: `N${i}`, phone: `900317788${i}` }));
  assert.equal(validateCoordinators(ten).ok, true);
  assert.equal(validateCoordinators([...ten, row({ name: "N10", phone: "9003177880" })]).ok, false);
});

test("hidden-field parsing", () => {
  assert.deepEqual(parseCoordinatorsField(null), { ok: true, coordinators: [] });
  assert.deepEqual(parseCoordinatorsField(""), { ok: true, coordinators: [] });
  assert.equal(parseCoordinatorsField("{not json").ok, false);
  assert.equal(parseCoordinatorsField('{"name":"A"}').ok, false);
  assert.deepEqual(parseCoordinatorsField('[{"name":"A","role":"","phone":"9003177881","email":""}]'), {
    ok: true,
    coordinators: [{ name: "A", phone: "9003177881" }],
  });
});

test("the app patterns and limits are the database guard (parity)", () => {
  const sql = read(MIGRATION);
  assert.ok(sql.includes(`(c ->> 'phone') !~ '${COORDINATOR_PHONE_PATTERN.source}'`), "phone pattern");
  assert.ok(sql.includes(`(c ->> 'email') !~ '${COORDINATOR_EMAIL_PATTERN.source}'`), "email pattern");
  assert.match(sql, new RegExp(`jsonb_array_length\\(p\\) > ${MAX_COORDINATORS} then return 'TOO_MANY'`));
  assert.match(sql, /add column if not exists coordinators jsonb not null default '\[\]'::jsonb/);
  assert.match(sql, /constraint events_coordinators_valid\s+check \(public\.event_coordinators_error\(coordinators\) is null\)/);
});

test("stored values render safely: invalid entries dropped, safe tel/mailto targets", () => {
  assert.deepEqual(normalizeStoredCoordinators(null), []);
  assert.deepEqual(normalizeStoredCoordinators("x"), []);
  assert.deepEqual(
    normalizeStoredCoordinators([{ name: "A", phone: "9003177881" }, { name: "No contact" }, 7, null]),
    [{ name: "A", phone: "9003177881" }],
  );
  assert.equal(telHref("+91 98400-12345"), "tel:+919840012345");
  assert.equal(telHref("044 2345 6789"), "tel:04423456789");
  assert.equal(mailHref("kavitha@smc.edu.in"), "mailto:kavitha@smc.edu.in");
  assert.equal(mailHref("a+b@x.in"), "mailto:a%2Bb@x.in");
  assert.deepEqual(coordinatorsToDrafts([{ name: "A", email: "a@x.in" }]), [{ name: "A", role: "", phone: "", email: "a@x.in" }]);
});

test("public page renders the cards component, which hides itself when empty", () => {
  const page = read("app/(public)/events/[slug]/page.tsx");
  assert.match(page, /<EventCoordinators coordinators=\{event\.coordinators\} \/>/);
  const cards = read("components/events/event-coordinators.tsx");
  assert.match(cards, /if \(list\.length === 0\) return null;/);
  assert.match(cards, /href=\{telHref\(c\.phone\)\}/);
  assert.match(cards, /href=\{mailHref\(c\.email\)\}/);
  assert.doesNotMatch(cards, /dangerouslySetInnerHTML/);
});

test("both admin event forms submit coordinators through the shared validator", () => {
  for (const f of ["components/admin/event-form.tsx", "components/admin/event-details-form.tsx"]) {
    assert.match(read(f), /<CoordinatorsEditor initial=\{coordinatorsToDrafts\(event\??\.coordinators\)\} \/>/, f);
  }
  assert.equal(read("lib/actions/admin.ts").match(/parseCoordinatorsField\(formData\.get\("coordinators"\)\)/g)?.length, 2);
  const ea = read("lib/actions/event-admin.ts");
  assert.match(ea, /parseCoordinatorsField\(formData\.get\("coordinators"\)\)/);
  assert.match(ea, /rpc\("admin_set_event_coordinators"/);
});
