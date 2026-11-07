"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { paymentVerificationService } from "@/lib/ocr";
import { notifyPaymentUnderReview } from "@/lib/email/notify";
import {
  BUCKETS,
  SCREENSHOT_ACCEPTED_TYPES,
  SCREENSHOT_MAX_BYTES,
  type PaymentStatus,
} from "@/lib/constants";
import { paymentBlockReason } from "@/lib/payment-intent";
import type { RegistrationRow } from "@/types/database";

const SUBMIT_ERRORS: Record<string, string> = {
  AUTH_REQUIRED: "Please sign in again.",
  REGISTRATION_NOT_FOUND: "Registration not found.",
  FORBIDDEN: "Registration not found.",
  TEAM_HEAD_PAYS: "Your team head completes the payment for your team.",
  EVENT_ARCHIVED:
    "This event has been archived, so new payments can't be submitted.",
  REGISTRATION_CANCELLED:
    "This registration was cancelled. Register again to take part.",
  ALREADY_PAID: "This registration is already paid and confirmed.",
  GENERAL_REGISTRATION_REQUIRED:
    "This event is included in General Registration, so it isn't paid individually. Complete General Registration instead.",
  HOLD_EXPIRED:
    "Your seat hold expired. Register for the event again to renew it, then submit your payment.",
  EVENT_FULL:
    "This event filled up while your payment was rejected, so it can't be resubmitted.",
  UTR_PREVIOUSLY_REJECTED:
    "That transaction ID was already rejected for this registration. Submit the screenshot and UTR of a different, valid payment.",
};

function mapSubmitError(message: string | undefined): string {
  if (message) {
    for (const key of Object.keys(SUBMIT_ERRORS)) {
      if (message.includes(key)) return SUBMIT_ERRORS[key];
    }
  }
  return "Could not submit payment.";
}

export type AnalyzeResult =
  | { ok: false; error: string }
  | { ok: true; ref: string | null; confidence: number; path: string };

export type ConfirmResult =
  | { ok: false; error: string }
  | { ok: true; status: PaymentStatus };

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Uploads the screenshot to the PRIVATE bucket, persists it against the
 * registration ('uploaded'), then runs server-side OCR and returns a candidate
 * reference for the user to confirm. The OCR key never leaves the server.
 */
export async function analyzeScreenshot(
  formData: FormData,
): Promise<AnalyzeResult> {
  const registrationId = String(formData.get("registration_id") ?? "");
  const file = formData.get("file");
  if (!registrationId) return { ok: false, error: "Missing registration." };
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: "Please choose a screenshot to upload." };

  if (!SCREENSHOT_ACCEPTED_TYPES.includes(file.type as never))
    return { ok: false, error: "Upload a PNG, JPG or WebP image." };
  if (file.size > SCREENSHOT_MAX_BYTES)
    return { ok: false, error: "Image is too large (max 5 MB)." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };

  // Confirm the registration is the caller's (RLS scopes this select) and
  // that a payment can be submitted at all before storing anything.
  const [{ data: reg, error: regError }, { data: states, error: statesError }] = await Promise.all([
    supabase
      .from("registrations")
      .select(
        "id, profile_id, team_id, is_team_head, registration_status, payment_status, event:events!registrations_event_id_fkey(archived_at, general_registration_covered)",
      )
      .eq("id", registrationId)
      .maybeSingle(),
    supabase.rpc("my_registration_states"),
  ]);
  const row = reg as
    | (Pick<
        RegistrationRow,
        | "id"
        | "profile_id"
        | "team_id"
        | "is_team_head"
        | "registration_status"
        | "payment_status"
      > & { event: { archived_at: string | null; general_registration_covered: boolean } | null })
    | null;
  if (regError || statesError) {
    console.error("payment submit: registration lookup failed:", regError ?? statesError);
    return { ok: false, error: "We couldn't load your registration just now. Please try again." };
  }
  if (!row || row.profile_id !== user.id)
    return { ok: false, error: "Registration not found." };
  const state =
    ((states ?? []) as { registration_id: string; expired_intent: boolean }[]).find(
      (s) => s.registration_id === registrationId,
    ) ?? null;
  const block = paymentBlockReason(
    row,
    state,
    Boolean(row.event?.archived_at),
    Boolean(row.event?.general_registration_covered),
  );
  if (block === "general_registration")
    return { ok: false, error: SUBMIT_ERRORS.GENERAL_REGISTRATION_REQUIRED };
  if (block === "team_member") return { ok: false, error: SUBMIT_ERRORS.TEAM_HEAD_PAYS };
  if (block === "archived") return { ok: false, error: SUBMIT_ERRORS.EVENT_ARCHIVED };
  if (block === "cancelled")
    return { ok: false, error: SUBMIT_ERRORS.REGISTRATION_CANCELLED };
  if (block === "paid") return { ok: false, error: SUBMIT_ERRORS.ALREADY_PAID };
  if (block === "expired") return { ok: false, error: SUBMIT_ERRORS.HOLD_EXPIRED };

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = EXT[file.type] ?? "png";
  const path = `${user.id}/${registrationId}-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKETS.paymentScreenshots)
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (upErr) return { ok: false, error: "Upload failed. Please try again." };

  const ocr = await paymentVerificationService.extract(buffer, file.type);

  // Persist the screenshot + OCR immediately (status 'uploaded'), even if the
  // user abandons before confirming a transaction id.
  const { error: submitErr } = await supabase.rpc("submit_payment", {
    p_registration_id: registrationId,
    p_transaction_id: null,
    p_screenshot: path,
    p_ocr_raw: ocr.raw || null,
    p_ocr_conf: ocr.confidence || null,
  });
  if (submitErr) {
    console.error("submit_payment (screenshot) failed:", submitErr);
    return { ok: false, error: mapSubmitError(submitErr.message) };
  }

  revalidatePath(`/dashboard/payment/${registrationId}`);
  return { ok: true, ref: ocr.ref, confidence: ocr.confidence, path };
}

/**
 * Confirms the (possibly user-corrected) transaction id. Duplicate detection
 * and status transitions happen inside the submit_payment RPC.
 */
export async function confirmPayment(
  formData: FormData,
): Promise<ConfirmResult> {
  const registrationId = String(formData.get("registration_id") ?? "");
  const transactionId = String(formData.get("transaction_id") ?? "").trim();
  if (!registrationId) return { ok: false, error: "Missing registration." };
  if (transactionId.length < 6)
    return { ok: false, error: "Enter a valid transaction / UTR number." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_payment", {
    p_registration_id: registrationId,
    p_transaction_id: transactionId,
    p_screenshot: null,
    p_ocr_raw: null,
    p_ocr_conf: null,
  });

  if (error) {
    console.error("submit_payment failed:", error);
    return { ok: false, error: mapSubmitError(error.message) };
  }

  const reg = (Array.isArray(data) ? data[0] : data) as RegistrationRow;
  revalidatePath(`/dashboard/payment/${registrationId}`);
  revalidatePath("/dashboard/registrations");
  revalidatePath("/dashboard");
  revalidatePath("/admin/payments");
  revalidatePath("/admin/registrations");
  revalidatePath("/admin");

  // Fire-and-catch notification (best effort — never blocks the response).
  if (reg.payment_status === "under_review") {
    try {
      await notifyPaymentUnderReview(registrationId);
    } catch (e) {
      console.error("payment email failed:", e);
    }
  }

  return { ok: true, status: reg.payment_status };
}
