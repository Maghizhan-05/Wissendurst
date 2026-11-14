/**
 * Private event WhatsApp group links (0034). The pattern mirrors the database
 * check on event_private_settings.whatsapp_group_url, so only an https
 * chat.whatsapp.com invite link can ever reach an email. Pure (no imports).
 */
export const WHATSAPP_GROUP_URL_PATTERN =
  /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,64}(\?[A-Za-z0-9=&_.-]{0,100})?$/;
export const MAX_WHATSAPP_URL_LENGTH = 200;

export type WhatsAppLinkResult = { ok: true; url: string | null } | { ok: false; error: string };

/** Form value → link to store (null clears it). */
export function parseWhatsAppGroupUrl(input: unknown): WhatsAppLinkResult {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value) return { ok: true, url: null };
  if (value.length > MAX_WHATSAPP_URL_LENGTH || !WHATSAPP_GROUP_URL_PATTERN.test(value))
    return {
      ok: false,
      error: "Use a WhatsApp group invite link like https://chat.whatsapp.com/AbCdEf123456.",
    };
  return { ok: true, url: value };
}

function escapeHtml(v: string): string {
  return v.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/**
 * Email block inviting a confirmed participant to the event's WhatsApp group.
 * Empty when there is no (valid) link, so callers can always interpolate it.
 */
export function whatsappGroupEmailBlock(url: string | null | undefined): string {
  if (!url || !WHATSAPP_GROUP_URL_PATTERN.test(url) || url.length > MAX_WHATSAPP_URL_LENGTH) return "";
  const href = escapeHtml(url);
  return `<div style="margin:20px 0 4px;padding:14px 16px;border:1px solid #cfe9d8;background:#f1fbf4;border-radius:12px;">
         <p style="margin:0 0 6px;font-weight:600;color:#102a2a;">Join the event WhatsApp group</p>
         <p style="margin:0 0 10px;line-height:1.6;color:#627775;">Organizers share updates for this event here. Please don't forward this private link.</p>
         <a href="${href}" style="color:#087f78;font-weight:600;word-break:break-all;">${href}</a>
       </div>`;
}
