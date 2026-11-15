/**
 * Outcome of a forgot-password request. Pure (unit-tested).
 *
 * Supabase Auth already answers success for unknown addresses, so a neutral
 * success keeps accounts private. When Auth refuses to send — email rate
 * limit, SMTP failure, or a recipient the built-in mailer won't deliver to —
 * the user must NOT be told a link is on its way. The failure copy is generic:
 * it never echoes the provider message or the address.
 */
export const RESET_SENT_MESSAGE = "If that email is registered, a reset link is on its way.";
export const RESET_FAILED_MESSAGE =
  "We couldn’t send the reset email right now. Please wait a few minutes and try again; if it keeps failing, contact the organizers.";

export type PasswordResetResult = { ok: true; message: string } | { ok: false; error: string };

export interface ResetError {
  status?: number;
  code?: string;
  message?: string;
}

export function passwordResetResult(error: ResetError | null | undefined): PasswordResetResult {
  if (!error) return { ok: true, message: RESET_SENT_MESSAGE };
  return { ok: false, error: RESET_FAILED_MESSAGE };
}
