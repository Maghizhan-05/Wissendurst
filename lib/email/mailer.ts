import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

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

function getTransport(): Transporter | null {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null; // not configured → emails are skipped

  if (cached) return cached;
  const port = Number(process.env.SMTP_PORT ?? 465);
  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return cached;
}

export function mailFrom(): string {
  return (
    process.env.MAIL_FROM ??
    `Wissendurst'27 <${process.env.SMTP_USER ?? "no-reply@example.com"}>`
  );
}

/**
 * Sends an email. Best-effort: if SMTP isn't configured it silently no-ops so
 * the surrounding user action never fails because email is unavailable.
 */
export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ sent: boolean }> {
  const transport = getTransport();
  if (!transport) {
    console.warn("[email] SMTP not configured; skipping:", opts.subject);
    return { sent: false };
  }
  await transport.sendMail({
    from: mailFrom(),
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
  return { sent: true };
}
