import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { createDelivery, type CheckOutcome, type DeliveryOutcome, type MailOptions } from "./delivery.ts";

export type { CheckOutcome, DeliveryOutcome, DeliveryErrorClass, DeliveryErrorCode, FailedOutcome, MailOptions } from "./delivery.ts";

/**
 * Gmail SMTP mailer. Requires a Google **App Password** (not the account
 * password) on an account with 2-Step Verification enabled.
 *
 * Env (server only — never NEXT_PUBLIC):
 *   SMTP_HOST   default smtp.gmail.com
 *   SMTP_PORT   default 465 (SSL). Use 587 for STARTTLS.
 *   SMTP_USER   your gmail address
 *   SMTP_PASS   the 16-char app password
 *   MAIL_FROM   optional display From, e.g. "Wissendurst'27 <you@gmail.com>"
 */
let cached: Transporter | null = null;

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport(): Transporter | null {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null; // not configured → emails are skipped

  if (cached) return cached;
  const port = Number(process.env.SMTP_PORT?.trim() || 465);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid SMTP port");
  }
  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST?.trim() || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    logger: false,
    debug: false,
  });
  return cached;
}

export function mailFrom(): string {
  return (
    process.env.MAIL_FROM?.trim() ||
    `Wissendurst'27 <${process.env.SMTP_USER ?? "no-reply@example.com"}>`
  );
}

const delivery = createDelivery({ getTransport, mailFrom });

/** Best-effort SMTP submission; callers persist/log the sanitized outcome. */
export async function sendMail(opts: MailOptions): Promise<DeliveryOutcome> {
  return delivery.sendMail(opts);
}

/** Checks SMTP connectivity/authentication only; never sends a message. */
export async function verifySmtp(): Promise<CheckOutcome> {
  return delivery.verifySmtp();
}
