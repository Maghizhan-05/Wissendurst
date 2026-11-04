"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { paymentVerificationService } from "@/lib/ocr";
import { requireScope } from "@/lib/auth";
import { defaultUpiId } from "@/lib/payment";
import {
  BUCKETS,
  SCREENSHOT_ACCEPTED_TYPES,
  SCREENSHOT_MAX_BYTES,
  type PaymentStatus,
} from "@/lib/constants";
import { mapGrError, sameUpi, UPI_ID_PATTERN } from "@/lib/general-registration";
import {
  notifyGeneralRegistrationRejected,
  notifyGeneralRegistrationSubmitted,
  notifyGeneralRegistrationVerified,
} from "@/lib/email/notify";
import type { GeneralRegistrationRow } from "@/types/database";
import type { AnalyzeResult, ConfirmResult } from "@/lib/actions/payment";
import type { AdminActionState } from "@/lib/actions/admin";

export type GrActionState = { ok: false; error: string } | { ok: true; message: string } | null;

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function revalidateParticipant() {
  revalidatePath("/general-registration");
  revalidatePath("/dashboard");
  revalidatePath("/", "layout"); // navbar shortcut + participant id
}

/* ── participant ─────────────────────────────────────────────────────────── */

/** Creates (or resumes) the caller's General Registration payment intent. */
export async function startGeneralRegistration(): Promise<GrActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_general_registration");
  if (error) return { ok: false, error: mapGrError(error.message, "Could not start General Registration.") };
  revalidatePath("/general-registration");
  revalidatePath("/dashboard");
  return { ok: true, message: "General Registration started." };
}

/** Uploads the screenshot to the private bucket, stores it, runs OCR server-side. */
export async function analyzeGeneralScreenshot(formData: FormData): Promise<AnalyzeResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: "Please choose a screenshot to upload." };
  if (!SCREENSHOT_ACCEPTED_TYPES.includes(file.type as never))
    return { ok: false, error: "Upload a PNG, JPG or WebP image." };
  if (file.size > SCREENSHOT_MAX_BYTES) return { ok: false, error: "Image is too large (max 5 MB)." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };

  const { data: gr } = await supabase
    .from("general_registrations")
    .select("id, status")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!gr) return { ok: false, error: "Start General Registration first." };
  if (gr.status === "verified") return { ok: false, error: "Your General Registration is already verified." };

  const buffer = Buffer.from(await file.arrayBuffer());
  const path = `${user.id}/general-registration-${Date.now()}.${EXT[file.type] ?? "png"}`;
  const { error: upErr } = await supabase.storage
    .from(BUCKETS.paymentScreenshots)
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (upErr) return { ok: false, error: "Upload failed. Please try again." };

  const ocr = await paymentVerificationService.extract(buffer, file.type);
  const { error } = await supabase.rpc("submit_general_registration_payment", {
    p_transaction_id: null,
    p_screenshot: path,
    p_ocr_raw: ocr.raw || null,
    p_ocr_conf: ocr.confidence || null,
  });
  if (error) {
    console.error("submit_general_registration_payment (screenshot) failed:", error);
    return { ok: false, error: mapGrError(error.message, "Could not save your screenshot.") };
  }
  revalidatePath("/general-registration");
  return { ok: true, ref: ocr.ref, confidence: ocr.confidence, path };
}

/** Confirms the (possibly corrected) UTR; duplicates are detected in the RPC. */
export async function confirmGeneralPayment(formData: FormData): Promise<ConfirmResult> {
  const transactionId = String(formData.get("transaction_id") ?? "").trim();
  if (!/^[A-Za-z0-9]{6,40}$/.test(transactionId))
    return { ok: false, error: "Enter a valid transaction / UTR number (letters and digits only)." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_general_registration_payment", {
    p_transaction_id: transactionId,
    p_screenshot: null,
    p_ocr_raw: null,
    p_ocr_conf: null,
  });
  if (error) {
    console.error("submit_general_registration_payment failed:", error);
    return { ok: false, error: mapGrError(error.message, "Could not submit payment.") };
  }
  const row = (Array.isArray(data) ? data[0] : data) as GeneralRegistrationRow;
  revalidateParticipant();
  revalidatePath("/admin/general-registration");
  if (row.status === "under_review") {
    try {
      await notifyGeneralRegistrationSubmitted(row.id);
    } catch (e) {
      console.error("GR submitted email failed:", e);
    }
  }
  return { ok: true, status: row.status as PaymentStatus };
}

/* ── admin (payments scope) ─────────────────────────────────────────────── */

const SETTINGS_ERRORS: Record<string, string> = {
  FORBIDDEN: "You don't have permission to manage General Registration.",
  INVALID_FEE: "Enter a fee between ₹0 and ₹1,00,000.",
  INVALID_UPI_ID: "Enter a valid UPI ID, e.g. name@bank.",
  GENERAL_REGISTRATION_INCOMPLETE: "To open General Registration, set a fee above ₹0, a dedicated UPI ID and a payee name.",
  GENERAL_REGISTRATION_UPI_NOT_DEDICATED: "This UPI ID is already used by an event. General Registration needs its own UPI ID.",
  EVENT_NOT_FOUND: "One of the selected events no longer exists.",
  EVENT_ARCHIVED: "Archived events can't be added to General Registration.",
  HAS_SUBEVENTS: "Select the individual sub-events, not their parent event.",
};
function mapSettingsError(message: string | undefined, fallback: string) {
  if (message) for (const k of Object.keys(SETTINGS_ERRORS)) if (message.includes(k)) return SETTINGS_ERRORS[k];
  return fallback;
}

export async function saveGeneralRegistrationSettings(
  _prev: GrActionState,
  formData: FormData,
): Promise<GrActionState> {
  await requireScope("payments");
  const enabled = formData.get("enabled") === "on";
  const rupees = Number(String(formData.get("fee") ?? "").trim() || "0");
  const upi = String(formData.get("upi_id") ?? "").trim();
  const payee = String(formData.get("payee_name") ?? "").trim();
  const description = String(formData.get("description") ?? "").slice(0, 2000);
  const instructions = String(formData.get("instructions") ?? "").slice(0, 2000);

  if (!Number.isFinite(rupees) || rupees < 0 || rupees > 100000 || Math.abs(Math.round(rupees * 100) - rupees * 100) > 1e-6)
    return { ok: false, error: SETTINGS_ERRORS.INVALID_FEE };
  if (upi && !UPI_ID_PATTERN.test(upi)) return { ok: false, error: SETTINGS_ERRORS.INVALID_UPI_ID };
  if (payee.length > 100) return { ok: false, error: "Payee name is too long (max 100 characters)." };
  // The site default UPI lives in the environment, so the DB can't see it.
  if (upi && sameUpi(upi, defaultUpiId()))
    return { ok: false, error: "This is the site's default event UPI ID. General Registration needs its own UPI ID." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_general_registration_settings", {
    p_enabled: enabled,
    p_fee: Math.round(rupees * 100),
    p_upi_id: upi || null,
    p_payee_name: payee,
    p_description: description,
    p_instructions: instructions,
  });
  if (error) return { ok: false, error: mapSettingsError(error.message, "Could not save settings.") };
  revalidatePath("/admin/general-registration");
  revalidatePath("/general-registration");
  revalidatePath("/", "layout");
  return { ok: true, message: "General Registration settings saved." };
}

export async function saveGeneralRegistrationEvents(
  _prev: GrActionState,
  formData: FormData,
): Promise<GrActionState> {
  await requireScope("payments");
  const ids = formData.getAll("event_id").map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_set_general_registration_events", { p_event_ids: ids });
  if (error) return { ok: false, error: mapSettingsError(error.message, "Could not save the included events.") };
  revalidatePath("/admin/general-registration");
  revalidatePath("/general-registration");
  revalidatePath("/events", "layout");
  return { ok: true, message: `${Number(data ?? 0)} event${Number(data) === 1 ? "" : "s"} included.` };
}

const REVIEW_ERRORS: Record<string, string> = {
  FORBIDDEN: "You don't have permission to review payments.",
  GENERAL_REGISTRATION_NOT_FOUND: "Payment not found.",
  GENERAL_REGISTRATION_ALREADY_VERIFIED: "This General Registration is already verified and can't be reversed.",
  NOTHING_TO_VERIFY: "There's no screenshot or UTR to verify yet.",
  GENERAL_REGISTRATION_REQUIRES_E_ID: "This participant doesn't hold a standard (E) participant ID, so it can't be converted.",
  PARTICIPANT_ID_SPACE_EXHAUSTED: "No General Registration IDs are left (W27/GR/9999 reached).",
  INVALID_STATUS: "Invalid decision.",
};

export async function reviewGeneralRegistration(formData: FormData): Promise<GrActionState> {
  await requireScope("payments");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  if (!id || (status !== "verified" && status !== "rejected")) return { ok: false, error: "Invalid request." };

  const supabase = await createClient();
  const { data: before } = await supabase.from("general_registrations").select("status").eq("id", id).maybeSingle();
  const { data, error } = await supabase.rpc("admin_review_general_registration", {
    p_id: id,
    p_status: status,
    p_note: note,
  });
  if (error) {
    const msg = error.message ?? "";
    for (const k of Object.keys(REVIEW_ERRORS)) if (msg.includes(k)) return { ok: false, error: REVIEW_ERRORS[k] };
    return { ok: false, error: "Could not update the payment." };
  }
  const row = (Array.isArray(data) ? data[0] : data) as GeneralRegistrationRow;
  const changed = before?.status !== row.status;
  if (changed) {
    try {
      if (row.status === "verified") await notifyGeneralRegistrationVerified(row.id);
      else if (row.status === "rejected") await notifyGeneralRegistrationRejected(row.id);
    } catch (e) {
      console.error("GR review email failed:", e);
    }
  }
  revalidatePath("/admin/general-registration");
  revalidatePath(`/admin/general-registration/${id}`);
  revalidatePath("/", "layout");
  return {
    ok: true,
    message:
      row.status === "verified"
        ? changed
          ? `Verified — participant ID is now ${row.new_participant_id}.`
          : "Already verified."
        : "Payment rejected. The participant keeps their current ID.",
  };
}

/** useActionState-compatible wrapper (confirmation dialog). */
export async function reviewGeneralRegistrationAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  return reviewGeneralRegistration(formData);
}
