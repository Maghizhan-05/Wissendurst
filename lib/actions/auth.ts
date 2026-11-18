"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/utils";
import { passwordResetResult } from "@/lib/auth/password-reset";
import { notifyWelcome } from "@/lib/email/notify";
import {
  BUCKETS,
  ID_CARD_ACCEPTED_TYPES,
  ID_CARD_MAX_BYTES,
} from "@/lib/constants";
import {
  forgotSchema,
  loginSchema,
  profileSchema,
  resetSchema,
  signupSchema,
} from "@/lib/validation/auth";

const ID_CARD_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export type AuthState =
  | { ok: false; error: string }
  | { ok: true; message?: string }
  | null;

function firstError(flat: Record<string, string[] | undefined>): string {
  for (const key of Object.keys(flat)) {
    const msgs = flat[key];
    if (msgs && msgs.length) return msgs[0];
  }
  return "Please check your details and try again.";
}

/** Email + password sign in. Redirects to `next` (or dashboard) on success. */
export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: firstError(parsed.error.flatten().fieldErrors) };
  }

  const supabase = await createClient();
  const { data: signInData, error } =
    await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { ok: false, error: "Invalid email or password." };
  }

  // Sign-up is approval-free (0035). A banned account keeps its session only
  // to see the blocked notice; an incomplete profile finishes itself first.
  const [{ data: profile }, { data: ban }] = await Promise.all([
    supabase.from("profiles").select("approval_status").eq("id", signInData.user.id).maybeSingle(),
    supabase.from("profile_bans").select("profile_id").eq("profile_id", signInData.user.id).maybeSingle(),
  ]);
  const status = (profile as { approval_status?: string } | null)?.approval_status;
  revalidatePath("/", "layout");
  if (ban) redirect("/blocked");
  if (status !== "approved") redirect("/application");

  const next = String(formData.get("next") ?? "/dashboard") || "/dashboard";
  revalidatePath("/", "layout");
  redirect(next.startsWith("/") ? next : "/dashboard");
}

/** Same text for a new and an already-registered email (no enumeration). */
const SIGNUP_DONE_MESSAGE =
  "Your account is ready — confirm your email with the link we just sent, then sign in. Your participant ID is in your welcome email.";

/** Sign up + profile metadata. Profile row is created by a DB trigger. */
export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signupSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    password: formData.get("password"),
    phone: formData.get("phone"),
    college: formData.get("college"),
    course: formData.get("course"),
    year: formData.get("year"),
  });
  if (!parsed.success) {
    return { ok: false, error: firstError(parsed.error.flatten().fieldErrors) };
  }

  // ID card is required for verification.
  const idCard = formData.get("id_card");
  if (!(idCard instanceof File) || idCard.size === 0) {
    return { ok: false, error: "Please upload a photo of your college ID card." };
  }
  if (!ID_CARD_ACCEPTED_TYPES.includes(idCard.type as never)) {
    return { ok: false, error: "ID card must be a PNG, JPG or WebP image." };
  }
  if (idCard.size > ID_CARD_MAX_BYTES) {
    return { ok: false, error: "ID card image is too large (max 5 MB)." };
  }

  const { email, password, ...meta } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: meta,
      emailRedirectTo: siteUrl("/auth/callback?next=/login"),
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes("already"))
      return { ok: false, error: "An account with this email already exists." };
    return { ok: false, error: error.message };
  }

  const userId = data.user?.id;
  // An already-registered email comes back as a user without identities:
  // never upload or attach anything to an existing account, and answer
  // exactly like a fresh sign-up awaiting email confirmation (no account
  // enumeration).
  if (!userId || (data.user?.identities && data.user.identities.length === 0)) {
    return { ok: true, message: SIGNUP_DONE_MESSAGE };
  }

  // Approval-free sign-up (0035): attach the ID card and activate the new
  // profile with its permanent participant ID in one database transaction.
  // Service role, because the new user may have no session yet.
  let participantId: string | null = null;
  try {
    const admin = createAdminClient();
    const ext = ID_CARD_EXT[idCard.type] ?? "png";
    const path = `${userId}/${Date.now()}.${ext}`;
    const { error: upErr } = await admin.storage
      .from(BUCKETS.idCards)
      .upload(path, Buffer.from(await idCard.arrayBuffer()), { contentType: idCard.type, upsert: false });
    if (upErr) throw upErr;
    const { data: activated, error: actErr } = await admin.rpc("server_complete_signup", {
      p_profile_id: userId,
      p_id_card_path: path,
    });
    if (actErr) throw actErr;
    participantId = (activated as { participant_id: string | null } | null)?.participant_id ?? null;
  } catch (e) {
    // The account exists but isn't active yet; signing in leads to
    // /application to finish it (nothing is fabricated).
    console.error("sign-up activation failed:", e);
  }

  if (participantId) {
    try {
      await notifyWelcome(userId);
    } catch {
      console.error("welcome email failed:", { errorClass: "unknown", errorCode: "UNKNOWN" });
    }
  }

  revalidatePath("/", "layout");
  if (data.session) redirect(participantId ? "/dashboard?welcome=1" : "/application");
  return {
    ok: true,
    message: participantId
      ? SIGNUP_DONE_MESSAGE
      : "Your account was created, but we couldn't finish your profile. Confirm your email, sign in and upload your college ID card again to get your participant ID.",
  };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = forgotSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { ok: false, error: firstError(parsed.error.flatten().fieldErrors) };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: siteUrl("/auth/callback?next=/reset-password"),
  });
  if (error) {
    // Auth refused to send (rate limit / SMTP / unauthorised recipient). Log the
    // code only — never the address — so it shows in the function logs.
    console.error("resetPasswordForEmail failed:", { status: error.status, code: error.code });
  }
  // Neutral success for unknown emails (Auth returns no error for them); a
  // real send failure is reported instead of a false "on its way".
  return passwordResetResult(error);
}

export async function updatePassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = resetSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { ok: false, error: firstError(parsed.error.flatten().fieldErrors) };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  redirect("/dashboard?reset=1");
}

/**
 * Finishes an incomplete (or legacy rejected) profile on the SAME account:
 * corrected details plus a new college ID card. Approval-free (0035): the
 * profile is activated and gets its permanent participant ID at once.
 */
export async function resubmitApplication(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = profileSchema.safeParse({
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
    college: formData.get("college"),
    course: formData.get("course"),
    year: formData.get("year"),
  });
  if (!parsed.success) {
    return { ok: false, error: firstError(parsed.error.flatten().fieldErrors) };
  }
  const idCard = formData.get("id_card");
  if (!(idCard instanceof File) || idCard.size === 0) {
    return { ok: false, error: "Upload a new photo of your college ID card." };
  }
  if (!ID_CARD_ACCEPTED_TYPES.includes(idCard.type as never)) {
    return { ok: false, error: "ID card must be a PNG, JPG or WebP image." };
  }
  if (idCard.size > ID_CARD_MAX_BYTES) {
    return { ok: false, error: "ID card image is too large (max 5 MB)." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/application");

  // Upload to the caller's own folder (private bucket, service role), then
  // the RPC checks the object exists and belongs to this account.
  const admin = createAdminClient();
  const ext = ID_CARD_EXT[idCard.type] ?? "png";
  const path = `${user.id}/${Date.now()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from(BUCKETS.idCards)
    .upload(path, Buffer.from(await idCard.arrayBuffer()), { contentType: idCard.type, upsert: false });
  if (upErr) {
    console.error("resubmission id card upload failed:", upErr);
    return { ok: false, error: "Couldn't upload your ID card. Please try again." };
  }

  const d = parsed.data;
  const { error } = await supabase.rpc("resubmit_my_application", {
    p_full_name: d.full_name,
    p_phone: d.phone,
    p_college: d.college,
    p_course: d.course,
    p_year: d.year,
    p_id_card_path: path,
  });
  if (error) {
    console.error("resubmit_my_application failed:", error);
    await admin.storage.from(BUCKETS.idCards).remove([path]);
    const m = error.message ?? "";
    if (m.includes("APPLICATION_ALREADY_ACTIVE")) redirect("/dashboard");
    if (m.includes("ACCOUNT_BANNED")) redirect("/blocked");
    if (m.includes("INVALID_PROFILE")) return { ok: false, error: "Please check your details and try again." };
    if (m.includes("INVALID_ID_CARD")) return { ok: false, error: "Upload a new photo of your college ID card." };
    return { ok: false, error: "Couldn't save your profile. Please try again." };
  }

  try {
    await notifyWelcome(user.id);
  } catch {
    console.error("welcome email failed:", { errorClass: "unknown", errorCode: "UNKNOWN" });
  }
  revalidatePath("/", "layout");
  revalidatePath("/admin/users");
  redirect("/dashboard?welcome=1");
}
