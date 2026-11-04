/**
 * General Registration helpers shared by server and client code (no secrets).
 */

/** W27/GR/0001-style ids belong to verified General Registration participants. */
export function isGeneralRegistrationId(participantId: string | null | undefined): boolean {
  return /^W27\/GR\/\d{4}$/.test(participantId ?? "");
}

/** Approved participants still on a standard E id may take General Registration. */
export function canTakeGeneralRegistration(
  participantId: string | null | undefined,
  approvalStatus: string | null | undefined,
): boolean {
  return approvalStatus === "approved" && /^W27\/E\/\d{4}$/.test(participantId ?? "");
}

/** UPI ids compare case-insensitively. */
export function sameUpi(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

export const UPI_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,255}@[A-Za-z][A-Za-z0-9]{1,63}$/;

/** Participant-facing messages for General Registration RPC errors. */
export const GR_ERRORS: Record<string, string> = {
  AUTH_REQUIRED: "Please sign in again.",
  NOT_APPROVED: "Your account needs to be approved first.",
  GENERAL_REGISTRATION_CLOSED: "General Registration isn't open right now.",
  PARTICIPANT_ID_REQUIRED: "You need an approved participant ID first.",
  GENERAL_REGISTRATION_NOT_STARTED: "Start General Registration first.",
  ALREADY_PAID: "Your General Registration is already verified.",
  INVALID_SCREENSHOT: "That screenshot couldn't be attached. Please upload it again.",
  INVALID_TRANSACTION_ID: "Enter the UTR / transaction number using letters and digits only.",
};

export function mapGrError(message: string | undefined, fallback: string): string {
  if (message) {
    for (const key of Object.keys(GR_ERRORS)) if (message.includes(key)) return GR_ERRORS[key];
  }
  return fallback;
}
