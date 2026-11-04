import { formatEventDate, formatINR, formatTime, siteUrl } from "@/lib/utils";
import type { EventRow } from "@/types/database";

/** Shared branded shell for all transactional emails (email-client safe). */
function shell(heading: string, bodyHtml: string, cta?: { label: string; href: string }): string {
  return `
  <div style="margin:0;padding:24px;background:#f5fbfa;font-family:Arial,Helvetica,sans-serif;color:#102a2a;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d5e5e2;border-radius:16px;overflow:hidden;">
      <div style="background:#071a1d;padding:20px 28px;">
        <span style="color:#f5fffd;font-size:18px;font-weight:700;letter-spacing:-0.02em;">Wissendurst'27</span>
        <span style="color:#32d6c1;font-size:12px;margin-left:8px;">Where medicine meets curiosity</span>
      </div>
      <div style="padding:28px;">
        <h1 style="margin:0 0 16px;font-size:22px;color:#102a2a;">${heading}</h1>
        ${bodyHtml}
        ${
          cta
            ? `<p style="margin:28px 0 4px;">
                 <a href="${cta.href}" style="display:inline-block;background:#087f78;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;">${cta.label}</a>
               </p>`
            : ""
        }
      </div>
      <div style="padding:16px 28px;border-top:1px solid #d5e5e2;color:#627775;font-size:12px;">
        You're receiving this because you registered on Wissendurst'27.
      </div>
    </div>
  </div>`;
}

function pid(participantId: string): string {
  return `<span style="font-family:monospace;background:#ecf6f4;border:1px solid #d5e5e2;border-radius:6px;padding:2px 8px;color:#087f78;font-weight:700;">${participantId}</span>`;
}

export function signupPendingEmail(name: string) {
  return {
    subject: "We received your Wissendurst'27 signup",
    html: shell(
      `Thanks, ${name || "there"} 👋`,
      `<p style="line-height:1.6;">Your account and ID card have been received and are now waiting for an organizer to approve.</p>
       <p style="line-height:1.6;color:#627775;">You'll get another email the moment you're approved — then you can log in and start registering for events.</p>`,
    ),
  };
}

export function approvalGrantedEmail(name: string, participantId: string) {
  return {
    subject: "You're approved — welcome to Wissendurst'27 ✅",
    html: shell(
      `You're in, ${name || "there"}! 🎉`,
      `<p style="line-height:1.6;">An organizer has approved your account. You can now log in. Your participant ID is ${pid(participantId)} — keep it handy for every event and payment.</p>`,
      { label: "Log in", href: siteUrl("/login") },
    ),
  };
}

export function approvalRejectedEmail(name: string) {
  return {
    subject: "Update on your Wissendurst'27 signup",
    html: shell(
      `Hi ${name || "there"}`,
      `<p style="line-height:1.6;">We're sorry — your account could not be approved at this time. If you think this is a mistake, please reply to this email or contact the organizers.</p>`,
    ),
  };
}

export function welcomeEmail(name: string, participantId: string) {
  return {
    subject: "Welcome to Wissendurst'27 — your participant ID",
    html: shell(
      `Welcome, ${name || "there"} 👋`,
      `<p style="line-height:1.6;color:#102a2a;">Your account is ready. Your participant ID is ${pid(participantId)} — you'll use it for every event and payment, so keep it handy.</p>
       <p style="line-height:1.6;color:#627775;">Browse the programme and register for as many events as you like.</p>`,
      { label: "Explore events", href: siteUrl("/events") },
    ),
  };
}

export function registrationEmail(
  name: string,
  participantId: string,
  event: EventRow,
  amountPaise: number,
) {
  const when = `${formatEventDate(event.event_date)}${
    event.start_time ? ` · ${formatTime(event.start_time)}` : ""
  }`;
  const paid = amountPaise === 0;
  return {
    subject: `Registered: ${event.title}`,
    html: shell(
      `You're registered for ${event.title}`,
      `<p style="line-height:1.6;">Hi ${name || "there"}, your registration is recorded against participant ID ${pid(participantId)}.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;">
         <tr><td style="padding:6px 0;color:#627775;">Event</td><td style="padding:6px 0;text-align:right;font-weight:600;">${event.title}</td></tr>
         <tr><td style="padding:6px 0;color:#627775;">When</td><td style="padding:6px 0;text-align:right;">${when}</td></tr>
         <tr><td style="padding:6px 0;color:#627775;">Venue</td><td style="padding:6px 0;text-align:right;">${event.venue ?? "TBA"}</td></tr>
         <tr><td style="padding:6px 0;color:#627775;">Fee</td><td style="padding:6px 0;text-align:right;">${paid ? "No charge" : formatINR(amountPaise)}</td></tr>
       </table>
       <p style="line-height:1.6;color:#627775;">${
         paid
           ? "No payment is due — your spot is confirmed."
           : "Next step: complete payment and upload your screenshot so organizers can verify your spot."
       }</p>`,
      paid
        ? { label: "View my events", href: siteUrl("/dashboard/registrations") }
        : { label: "Complete payment", href: siteUrl("/dashboard/registrations") },
    ),
  };
}

export function paymentUnderReviewEmail(
  name: string,
  event: EventRow,
  amountPaise: number,
  transactionId: string | null,
) {
  return {
    subject: `Payment received — under review (${event.title})`,
    html: shell(
      "Payment received",
      `<p style="line-height:1.6;">Thanks ${name || "there"} — we've received your payment of <strong>${formatINR(
        amountPaise,
      )}</strong> for <strong>${event.title}</strong>${
        transactionId ? ` (txn ${transactionId})` : ""
      }.</p>
       <p style="line-height:1.6;color:#627775;">An organizer will verify it shortly. You'll get another email once it's confirmed.</p>`,
      { label: "View status", href: siteUrl("/dashboard/registrations") },
    ),
  };
}

export function paymentConfirmedEmail(
  name: string,
  event: EventRow,
) {
  const when = `${formatEventDate(event.event_date)}${
    event.start_time ? ` · ${formatTime(event.start_time)}` : ""
  }`;
  return {
    subject: `Payment confirmed — you're in for ${event.title} ✅`,
    html: shell(
      "Your spot is confirmed 🎉",
      `<p style="line-height:1.6;">Hi ${name || "there"}, your payment for <strong>${event.title}</strong> has been verified. You're all set.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;">
         <tr><td style="padding:6px 0;color:#627775;">Event</td><td style="padding:6px 0;text-align:right;font-weight:600;">${event.title}</td></tr>
         <tr><td style="padding:6px 0;color:#627775;">When</td><td style="padding:6px 0;text-align:right;">${when}</td></tr>
         <tr><td style="padding:6px 0;color:#627775;">Venue</td><td style="padding:6px 0;text-align:right;">${event.venue ?? "TBA"}</td></tr>
       </table>
       <p style="line-height:1.6;color:#627775;">See you there!</p>`,
      { label: "View my events", href: siteUrl("/dashboard/registrations") },
    ),
  };
}
