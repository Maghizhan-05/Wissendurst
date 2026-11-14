/**
 * Private per-event Google Form link (0035 / D-023). The patterns mirror the
 * database check on event_private_settings.google_form_url: only Google Forms
 * RESPONSE links (forms.gle short links, or docs.google.com/forms/d/…/viewform
 * or …/formResponse) — never edit links or other sites. Pure (no imports).
 */
export const GOOGLE_FORM_SHORT_PATTERN = /^https:\/\/forms\.gle\/[A-Za-z0-9_-]{6,64}$/;
export const GOOGLE_FORM_LONG_PATTERN =
  /^https:\/\/docs\.google\.com\/forms\/d\/(e\/)?[A-Za-z0-9_-]{20,128}\/(viewform|formResponse)(\?[A-Za-z0-9=&_.%+-]{0,255})?$/;
export const MAX_GOOGLE_FORM_URL_LENGTH = 500;

export function isGoogleFormResponseUrl(url: string | null | undefined): url is string {
  return (
    typeof url === "string" &&
    url.length <= MAX_GOOGLE_FORM_URL_LENGTH &&
    (GOOGLE_FORM_SHORT_PATTERN.test(url) || GOOGLE_FORM_LONG_PATTERN.test(url))
  );
}

export type GoogleFormLinkResult = { ok: true; url: string | null } | { ok: false; error: string };

/** Form value → link to store (null clears it). */
export function parseGoogleFormUrl(input: unknown): GoogleFormLinkResult {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value) return { ok: true, url: null };
  if (!isGoogleFormResponseUrl(value))
    return {
      ok: false,
      error:
        "Use the form's share link — https://forms.gle/… or https://docs.google.com/forms/d/e/…/viewform. Edit links and other sites aren't accepted.",
    };
  return { ok: true, url: value };
}

function escapeHtml(v: string): string {
  return v.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** Payment-confirmed email block; empty unless the link is a valid response URL. */
export function googleFormEmailBlock(url: string | null | undefined): string {
  if (!isGoogleFormResponseUrl(url)) return "";
  const href = escapeHtml(url);
  return `<div style="margin:20px 0 4px;padding:14px 16px;border:1px solid #d5e5e2;background:#f5fbfa;border-radius:12px;">
         <p style="margin:0 0 6px;font-weight:600;color:#102a2a;">One more step: fill in the event form</p>
         <p style="margin:0 0 10px;line-height:1.6;color:#627775;">The organizers need a few details from you for this event. Please don't share this private link.</p>
         <a href="${href}" style="color:#087f78;font-weight:600;word-break:break-all;">${href}</a>
       </div>`;
}
