import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AdminScope } from "@/lib/constants";
import type { ProfileRow } from "@/types/database";

/** Whether a profile is any kind of admin (super or scoped). */
export function isAdminProfile(profile: ProfileRow | null): boolean {
  return profile?.role === "admin";
}

/** Whether a profile may access a given admin area. */
export function profileHasScope(
  profile: ProfileRow | null,
  scope: AdminScope,
): boolean {
  if (!profile || profile.role !== "admin") return false;
  return profile.is_super_admin || (profile.admin_scopes ?? []).includes(scope);
}

/** Returns the current auth user or null. Revalidates the token. */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Returns the current user's profile row, or null if signed out. */
export async function getProfile(): Promise<ProfileRow | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return (data as ProfileRow) ?? null;
}

/** Requires a signed-in user; redirects to /login otherwise. */
export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/** Requires an approved profile; redirects otherwise. */
export async function requireProfile(): Promise<ProfileRow> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.approval_status === "rejected") redirect("/application");
  if (profile.approval_status !== "approved") redirect("/pending-approval");
  return profile;
}

/** Requires an approved admin (super or scoped); redirects non-admins home. */
export async function requireAdmin(): Promise<ProfileRow> {
  const profile = await getProfile();
  if (!profile) redirect("/login?next=/admin");
  if (profile.approval_status === "rejected") redirect("/application");
  if (profile.approval_status !== "approved") redirect("/pending-approval");
  if (profile.role !== "admin") redirect("/");
  return profile;
}

/** Requires an admin with a specific scope; sends other admins to the overview. */
export async function requireScope(scope: AdminScope): Promise<ProfileRow> {
  const profile = await requireAdmin();
  if (!profileHasScope(profile, scope)) redirect("/admin");
  return profile;
}

/** Requires the super admin. */
export async function requireSuperAdmin(): Promise<ProfileRow> {
  const profile = await requireAdmin();
  if (!profile.is_super_admin) redirect("/admin");
  return profile;
}
