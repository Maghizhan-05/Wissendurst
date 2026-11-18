import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createDelivery } from "./email/delivery.ts";

test("accepted send forwards the message and returns only a SHA256 message ID fingerprint", async () => {
  for (const id of ["<opaque@provider.example>", "opaque-id", undefined, "", 42]) {
    const calls: unknown[] = [];
    const delivery = createDelivery({
      getTransport: () => ({ sendMail: (opts) => { calls.push(opts); return Promise.resolve({ messageId: id, response: "private provider response" }); }, verify: () => true }),
      mailFrom: () => "sender@example.com",
    });
    assert.deepEqual(await delivery.sendMail({ ...message, text: "Private text" }), {
      status: "sent",
      providerMessageId: typeof id === "string" && id.length ? createHash("sha256").update(id).digest("hex") : null,
    });
    assert.deepEqual(calls, [{ ...message, text: "Private text", from: "sender@example.com" }]);
  }
});

test("transport failures resolve sanitized allowlisted outcomes for synchronous and asynchronous errors", async () => {
  const cases = [
    ["EAUTH", "authentication", "EAUTH"], ["ECONNECTION", "connection", "ECONNECTION"],
    ["ECONNREFUSED", "connection", "ECONNECTION"], ["EDNS", "connection", "EDNS"],
    ["ENOTFOUND", "connection", "EDNS"], ["EAI_AGAIN", "connection", "EDNS"],
    ["ECONNRESET", "connection", "ECONNECTION"], ["ESOCKET", "connection", "ESOCKET"],
    ["ETIMEDOUT", "timeout", "ETIMEDOUT"], ["ETLS", "provider", "ESOCKET"],
    ["EENVELOPE", "provider", "EENVELOPE"], ["ENVELOPE", "unknown", "UNKNOWN"],
    ["EMESSAGE", "provider", "EMESSAGE"], ["ESTREAM", "provider", "ESTREAM"],
    ["recipient@example.com secret", "unknown", "UNKNOWN"], ["__proto__", "unknown", "UNKNOWN"],
  ];
  for (const [code, errorClass, errorCode] of cases) {
    for (const asynchronous of [false, true]) {
      const error = { code, message: "secret password recipient@example.com", response: "private SMTP response", stack: "private stack" };
      const delivery = createDelivery({
        getTransport: () => ({ sendMail: () => { if (asynchronous) return Promise.reject(error); throw error; }, verify: () => true }),
        mailFrom: () => "sender@example.com",
      });
      assert.deepEqual(await delivery.sendMail(message), { status: "failed", errorClass, errorCode });
    }
  }
  for (const error of [null, undefined, "secret raw error", new Error("private"), { get code() { throw new Error("private getter"); } }]) {
    const delivery = createDelivery({ getTransport: () => ({ sendMail: () => { throw error; }, verify: () => true }), mailFrom: () => "sender@example.com" });
    assert.deepEqual(await delivery.sendMail(message), { status: "failed", errorClass: "unknown", errorCode: "UNKNOWN" });
  }
});

test("SMTP verification checks the transport without sending mail or reading sender", async () => {
  let checks = 0;
  const delivery = createDelivery({
    getTransport: () => ({ sendMail: () => { throw new Error("must never send"); }, verify: () => { checks++; return Promise.resolve(true); } }),
    mailFrom: () => { throw new Error("must not read sender"); },
  });
  assert.deepEqual(await delivery.verifySmtp(), { status: "verified" });
  assert.equal(checks, 1);
  assert.deepEqual(await createDelivery({ getTransport: () => null, mailFrom: () => "unused" }).verifySmtp(), { status: "not_configured" });
});

test("verification failures never reject or expose raw error data", async () => {
  for (const asynchronous of [false, true]) {
    const delivery = createDelivery({
      getTransport: () => ({ sendMail: () => { throw new Error("must never send"); }, verify: () => { const error = { code: "EAUTH", message: "secret" }; if (asynchronous) return Promise.reject(error); throw error; } }),
      mailFrom: () => "unused",
    });
    assert.deepEqual(await delivery.verifySmtp(), { status: "failed", errorClass: "authentication", errorCode: "EAUTH" });
  }
});

test("verification requires an affirmative transport result", async () => {
  for (const result of [false, undefined, null, "private response"]) {
    const delivery = createDelivery({ getTransport: () => ({ sendMail: () => undefined, verify: () => result }), mailFrom: () => "unused" });
    assert.deepEqual(await delivery.verifySmtp(), { status: "failed", errorClass: "unknown", errorCode: "UNKNOWN" });
  }
});

test("resolved recipient rejection or empty accepted list is a provider failure", async () => {
  for (const response of [
    { accepted: [], rejected: [] },
    { accepted: [], rejected: [message.to] },
    { accepted: [message.to], rejected: ["other-private@example.com"] },
    { rejected: [message.to] },
  ]) {
    const delivery = createDelivery({ getTransport: () => ({ sendMail: () => ({ ...response, messageId: "<private@provider.example>" }), verify: () => true }), mailFrom: () => "sender@example.com" });
    assert.deepEqual(await delivery.sendMail(message), { status: "failed", errorClass: "provider", errorCode: "EENVELOPE" });
  }
});

test("nodemailer wrapper preserves SMTP defaults, bounds timeouts, and verifies without test sends", () => {
  // Isolated process with an empty environment: no real SMTP configuration is read.
  // Both server-only and nodemailer are replaced before importing the wrapper.
  const script = `
    import assert from "node:assert/strict";
    import { registerHooks } from "node:module";
    let options;
    let creates = 0;
    let sends = 0;
    let checks = 0;
    let createError;
    globalThis.fakeMailer = { createTransport(value) {
      creates++;
      if (createError) throw createError;
      options = value;
      return { sendMail() { sends++; throw new Error("tests must not send"); }, verify() { checks++; return Promise.resolve(true); } };
    } };
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
      if (specifier === "nodemailer") return { url: "data:text/javascript,export default globalThis.fakeMailer", shortCircuit: true };
      return nextResolve(specifier, context);
    } });
    const url = ${JSON.stringify(new URL("./email/mailer.ts", import.meta.url).href)};
    const mailer = await import(url);
    assert.equal(mailer.smtpConfigured(), false);
    assert.deepEqual(await mailer.verifySmtp(), { status: "not_configured" });
    assert.deepEqual(await mailer.sendMail({to:"fake@example.com",subject:"fake",html:"fake"}), { status: "not_configured" });
    assert.equal(creates, 0);
    process.env.SMTP_USER = "fake@example.com";
    process.env.SMTP_PASS = "synthetic-test-value";
    assert.equal(mailer.smtpConfigured(), true);
    assert.deepEqual(await mailer.verifySmtp(), { status: "verified" });
    assert.equal(options.host, "smtp.gmail.com");
    assert.equal(options.port, 465);
    assert.equal(options.secure, true);
    assert.deepEqual(options.auth, { user: "fake@example.com", pass: "synthetic-test-value" });
    for (const key of ["connectionTimeout", "greetingTimeout", "socketTimeout"]) {
      assert.equal(Number.isFinite(options[key]), true);
      assert.ok(options[key] > 0 && options[key] <= 30000);
    }
    assert.equal(options.logger, false);
    assert.equal(options.debug, false);
    assert.equal(mailer.mailFrom(), "Wissendurst'27 <fake@example.com>");
    process.env.MAIL_FROM = "Synthetic sender <fake@example.com>";
    assert.equal(mailer.mailFrom(), process.env.MAIL_FROM);
    assert.deepEqual(await mailer.verifySmtp(), { status: "verified" });
    assert.equal(creates, 1);
    assert.equal(checks, 2);
    process.env.SMTP_HOST = "fake.invalid";
    process.env.SMTP_PORT = "587";
    const custom = await import(url + "?custom");
    assert.deepEqual(await custom.verifySmtp(), { status: "verified" });
    assert.equal(options.host, "fake.invalid");
    assert.equal(options.port, 587);
    assert.equal(options.secure, false);
    process.env.SMTP_HOST = "   ";
    process.env.SMTP_PORT = "   ";
    process.env.MAIL_FROM = "   ";
    const empty = await import(url + "?empty");
    assert.deepEqual(await empty.verifySmtp(), { status: "verified" });
    assert.equal(options.host, "smtp.gmail.com");
    assert.equal(options.port, 465);
    assert.equal(empty.mailFrom(), "Wissendurst'27 <fake@example.com>");
    for (const port of ["not-a-port", "0", "65536", "12.5", "-1"]) {
      process.env.SMTP_PORT = port;
      const invalid = await import(url + "?invalid=" + encodeURIComponent(port));
      assert.deepEqual(await invalid.verifySmtp(), { status: "failed", errorClass: "unknown", errorCode: "UNKNOWN" });
      assert.deepEqual(await invalid.sendMail({to:"fake@example.com",subject:"fake",html:"fake"}), { status: "failed", errorClass: "unknown", errorCode: "UNKNOWN" });
    }
    process.env.SMTP_PORT = "465";
    createError = { code: "EAUTH", message: "synthetic private error" };
    const broken = await import(url + "?broken");
    assert.deepEqual(await broken.verifySmtp(), { status: "failed", errorClass: "authentication", errorCode: "EAUTH" });
    assert.deepEqual(await broken.sendMail({to:"fake@example.com",subject:"fake",html:"fake"}), { status: "failed", errorClass: "authentication", errorCode: "EAUTH" });
    assert.equal(sends, 0);
  `;
  const result = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--input-type=module", "--eval", script], { env: { NODE_ENV: "test" }, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || String(result.error ?? ""));
  assert.equal(result.stdout, "");
});

test("configuration and sender failures never reject or log private data", async (t) => {
  const logs = ["log", "warn", "error", "info", "debug"] as const;
  for (const method of logs) t.mock.method(console, method, () => {});
  const error = new Error("private configuration password recipient@example.com");
  for (const getTransport of [() => { throw error; }, () => Promise.reject(error)]) {
    const delivery = createDelivery({ getTransport, mailFrom: () => "unused" });
    const expected = { status: "failed", errorClass: "unknown", errorCode: "UNKNOWN" };
    assert.deepEqual(await delivery.sendMail(message), expected);
    assert.deepEqual(await delivery.verifySmtp(), expected);
  }
  let sends = 0;
  const delivery = createDelivery({
    getTransport: () => ({ sendMail: () => { sends++; }, verify: () => true }),
    mailFrom: () => { throw error; },
  });
  assert.deepEqual(await delivery.sendMail(message), { status: "failed", errorClass: "unknown", errorCode: "UNKNOWN" });
  assert.equal(sends, 0);
  for (const method of logs) assert.equal((console[method] as unknown as { mock: { callCount(): number } }).mock.callCount(), 0);
});

const message = { to: "recipient@example.com", subject: "Private subject", html: "Private body" };

test("unconfigured delivery is explicit and never attempts a send", async () => {
  const delivery = createDelivery({ getTransport: () => null, mailFrom: () => { throw new Error("must not read sender"); } });
  assert.deepEqual(await delivery.sendMail(message), { status: "not_configured" });
});
