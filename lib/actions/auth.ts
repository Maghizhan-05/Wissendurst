"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/utils";
import { notifySignupPending } from "@/lib/email/notify";
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

  // Approval gate — only approved accounts keep a session.
  const { data: profile } = await supabase
    .from("profiles")
    .select("approval_status")
    .eq("id", signInData.user.id)
    .maybeSingle();
  const status = (profile as { approval_status?: string } | null)?.approval_status;
  if (status === "rejected") {
    // A rejected applicant keeps a session for one thing only: correcting and
    // resubmitting the same application (/application; every other signed-in
    // area redirects there).
    revalidatePath("/", "layout");
    redirect("/application");
  }
  if (status !== "approved") {
    await supabase.auth.signOut();
    return {
      ok: false,
      error:
        "Your account is awaiting approval. You'll get an email once an organizer approves it.",
    };
  }

  const next = String(formData.get("next") ?? "/dashboard") || "/dashboard";
  revalidatePath("/", "layout");
  redirect(next.startsWith("/") ? next : "/dashboard");
}

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
  if (userId) {
    // Upload the ID card + attach it to the profile using the service role,
    // because the new user has no session yet.
    try {
      const admin = createAdminClient();
      const buffer = Buffer.from(await idCard.arrayBuffer());
      const ext = ID_CARD_EXT[idCard.type] ?? "png";
      const path = `${userId}/${Date.now()}.${ext}`;
      await admin.storage
        .from(BUCKETS.idCards)
        .upload(path, buffer, { contentType: idCard.type, upsert: true });
      await admin.from("profiles").update({ id_card_path: path }).eq("id", userId);
    } catch (e) {
      console.error("id card upload failed:", e);
    }

    try {
      await notifySignupPending(userId);
    } catch (e) {
      console.error("signup email failed:", e);
    }
  }

  // Pending users must NOT get in — drop any session Supabase created.
  if (data.session) {
    await supabase.auth.signOut();
  }

  revalidatePath("/", "layout");
  return {
    ok: true,
    message:
      "Thanks! Your account is pending organizer approval. We'll email you as soon as it's approved — then you can sign in.",
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
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: siteUrl("/auth/callback?next=/reset-password"),
  });
  // Always report success to avoid leaking which emails are registered.
  return {
    ok: true,
    message: "If that email is registered, a reset link is on its way.",
  };
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
 * A rejected applicant corrects their details and uploads a replacement
 * college ID card on the SAME account (0031 resubmit_my_application). The
 * application returns to pending; no participant ID is issued until approval.
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
    if (m.includes("APPLICATION_NOT_REJECTED"))
      return { ok: false, error: "Your application isn't in a rejected state, so there's nothing to resubmit." };
    if (m.includes("INVALID_PROFILE")) return { ok: false, error: "Please check your details and try again." };
    if (m.includes("INVALID_ID_CARD")) return { ok: false, error: "Upload a new photo of your college ID card." };
    return { ok: false, error: "Couldn't resubmit your application. Please try again." };
  }

  try {
    await notifySignupPending(user.id);
  } catch (e) {
    console.error("resubmission email failed:", e);
  }
  revalidatePath("/", "layout");
  revalidatePath("/admin/approvals");
  redirect("/pending-approval?resubmitted=1");
}
