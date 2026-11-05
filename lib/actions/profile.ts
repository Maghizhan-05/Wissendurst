"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { profileSchema } from "@/lib/validation/auth";

export type ProfileState =
  | { ok: false; error: string }
  | { ok: true; message: string }
  | null;

export async function updateProfile(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const parsed = profileSchema.safeParse({
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
    college: formData.get("college"),
    course: formData.get("course"),
    year: formData.get("year"),
  });
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    const first = Object.values(flat).flat()[0];
    return { ok: false, error: first ?? "Please check your details." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Narrow RPC: participants can only change these five fields (0022).
  const { error } = await supabase.rpc("update_my_profile", {
    p_full_name: parsed.data.full_name,
    p_phone: parsed.data.phone,
    p_college: parsed.data.college,
    p_course: parsed.data.course,
    p_year: parsed.data.year,
  });

  if (error) {
    if (error.message?.includes("INVALID_PROFILE"))
      return { ok: false, error: "Please check your details." };
    return { ok: false, error: "Could not save changes." };
  }

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard");
  return { ok: true, message: "Profile updated." };
}

/**
 * Saves the profile photo after the client uploads it to the profile-images
 * bucket. Takes the storage object path ("<uid>/<file>"), never a URL; build
 * the public URL with profilePhotoUrl().
 */
export async function saveProfilePhoto(objectPath: string): Promise<ProfileState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // The RPC accepts only an uploaded object in the caller's own folder.
  const { error } = await supabase.rpc("set_my_profile_photo", { p_path: objectPath });
  if (error) {
    if (error.message?.includes("INVALID_PHOTO_PATH") || error.message?.includes("PHOTO_NOT_UPLOADED"))
      return { ok: false, error: "Upload the photo to your own folder first." };
    return { ok: false, error: "Could not update photo." };
  }

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard");
  return { ok: true, message: "Photo updated." };
}
