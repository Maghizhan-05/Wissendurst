import "server-only";
import QRCode from "qrcode";

/** The site-wide default UPI id used when no event (or ancestor) sets one. */
export function defaultUpiId(): string {
  return process.env.NEXT_PUBLIC_UPI_ID ?? "wissendurst@examplebank";
}

/**
 * Builds a standard UPI intent URI. Amount is given in paise. `upiId` lets a
 * specific event override the site default (resolved by the caller).
 */
export function buildUpiUri(
  amountPaise: number,
  note: string,
  upiId?: string | null,
): string {
  const pa = upiId && upiId.trim() ? upiId.trim() : defaultUpiId();
  const pn = process.env.NEXT_PUBLIC_UPI_PAYEE_NAME ?? "Wissendurst 27";
  const am = (amountPaise / 100).toFixed(2);
  const params = new URLSearchParams({
    pa,
    pn,
    am,
    cu: "INR",
    tn: note,
  });
  return `upi://pay?${params.toString()}`;
}

/**
 * UPI URI for an explicitly configured destination — never falls back to the
 * site default (General Registration must pay its dedicated UPI only).
 */
export function buildDedicatedUpiUri(
  amountPaise: number,
  note: string,
  upiId: string,
  payeeName: string,
): string {
  const pa = upiId.trim();
  if (!pa) throw new Error("A dedicated UPI id is required.");
  const params = new URLSearchParams({
    pa,
    pn: payeeName.trim() || pa,
    am: (amountPaise / 100).toFixed(2),
    cu: "INR",
    tn: note,
  });
  return `upi://pay?${params.toString()}`;
}

export async function dedicatedUpiQrDataUrl(
  amountPaise: number,
  note: string,
  upiId: string,
  payeeName: string,
): Promise<string> {
  return QRCode.toDataURL(buildDedicatedUpiUri(amountPaise, note, upiId, payeeName), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
    color: { dark: "#0b2528", light: "#ffffff" },
  });
}

/** Renders the UPI URI to a QR code data URL (no external services). */
export async function upiQrDataUrl(
  amountPaise: number,
  note: string,
  upiId?: string | null,
): Promise<string> {
  const uri = buildUpiUri(amountPaise, note, upiId);
  return QRCode.toDataURL(uri, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
    color: { dark: "#0b2528", light: "#ffffff" },
  });
}
