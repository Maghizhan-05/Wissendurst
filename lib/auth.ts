import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { queryError } from "@/lib/supabase/query-error";
import type { AdminScope, EventPermission } from "@/lib/constants";
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

/**
 * Whether the signed-in account is banned (0035). RLS lets an account read
 * its own ban row. A failed lookup throws (error boundary) rather than
 * guessing; the database enforces bans independently.
 */
export async function isBanned(profileId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profile_bans")
    .select("profile_id")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw queryError("profile_bans", error);
  return data != null;
}

/** Ban state of the current account, plus its active profile, for gating. */
async function requireActiveAccount(loginNext: string): Promise<ProfileRow> {
  const profile = await getProfile();
  if (!profile) redirect(loginNext);
  if (await isBanned(profile.id)) redirect("/blocked");
  // Approval-free sign-up (0035): an inactive profile only lacks its own
  // sign-up details/ID card and finishes them on /application.
  if (profile.approval_status !== "approved") redirect("/application");
  return profile;
}

/** Requires an active (not banned, sign-up complete) profile; redirects otherwise. */
export async function requireProfile(): Promise<ProfileRow> {
  return requireActiveAccount("/login");
}

/** Requires an active admin (super or scoped); redirects non-admins home. */
export async function requireAdmin(): Promise<ProfileRow> {
  const profile = await requireActiveAccount("/login?next=/admin");
  if (profile.role !== "admin") redirect("/");
  return profile;
}

/* ── Per-event administrators (0034) ──────────────────────────────────────
 * Authorization resolves as: super admin, OR the matching global area scope,
 * OR a matching event assignment. Assignments are additive: they never change
 * a profile's role/scopes, and an account may hold them without being a
 * global admin. The database enforces the same rule (has_event_permission);
 * these helpers decide what the admin UI shows and loads.
 */

export interface EventAssignment {
  eventId: string;
  permissions: EventPermission[];
}

export interface AdminAccess {
  profile: ProfileRow;
  /** Global admin (super or scoped) — role = admin. */
  isAdmin: boolean;
  isSuper: boolean;
  /** Global area scopes (empty unless role = admin). */
  scopes: AdminScope[];
  /** Per-event assignments of this (approved) account. */
  assignments: EventAssignment[];
}

/** The signed-in account's own event assignments (RLS: own rows only). */
async function loadAssignments(profileId: string): Promise<EventAssignment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_admin_assignments")
    .select("event_id, permissions")
    .eq("profile_id", profileId);
  if (error) throw queryError("event_admin_assignments", error);
  return ((data ?? []) as { event_id: string; permissions: EventPermission[] }[]).map((a) => ({
    eventId: a.event_id,
    permissions: a.permissions,
  }));
}

/** Admin access of the current request's account (memoised per request). */
export const getAdminAccess = cache(async (): Promise<AdminAccess | null> => {
  const profile = await getProfile();
  if (!profile || profile.approval_status !== "approved") return null;
  if (await isBanned(profile.id)) return null; // banned: no admin power (0035)
  const isAdmin = profile.role === "admin";
  return {
    profile,
    isAdmin,
    isSuper: isAdmin && profile.is_super_admin,
    scopes: isAdmin ? (profile.admin_scopes ?? []) : [],
    assignments: await loadAssignments(profile.id),
  };
});

/**
 * Whether the signed-in account may open /admin at all (navigation links).
 * Best effort: a failed lookup hides the link instead of breaking the page.
 */
export async function canOpenAdmin(profile: ProfileRow | null): Promise<boolean> {
  if (!profile || profile.approval_status !== "approved") return false;
  try {
    if (await isBanned(profile.id)) return false;
    if (profile.role === "admin") return true;
    return (await loadAssignments(profile.id)).length > 0;
  } catch (e) {
    console.error("event admin lookup failed:", e);
    return false;
  }
}

/** Global scope check on an access object (super admin has every scope). */
export function hasGlobalScope(access: AdminAccess, scope: AdminScope): boolean {
  return access.isAdmin && (access.isSuper || access.scopes.includes(scope));
}

/** Global scope, or the permission on at least one assigned event. */
export function hasAreaAccess(access: AdminAccess, permission: EventPermission): boolean {
  return (
    hasGlobalScope(access, permission) ||
    access.assignments.some((a) => a.permissions.includes(permission))
  );
}

/** The permission on one event: global scope or a matching assignment. */
export function canOnEvent(
  access: AdminAccess,
  eventId: string,
  permission: EventPermission,
): boolean {
  return (
    hasGlobalScope(access, permission) ||
    access.assignments.some((a) => a.eventId === eventId && a.permissions.includes(permission))
  );
}

/** "all" for a global scope holder, else the assigned event ids. */
export function eventIdsWith(
  access: AdminAccess,
  permission: EventPermission,
): "all" | string[] {
  if (hasGlobalScope(access, permission)) return "all";
  return access.assignments
    .filter((a) => a.permissions.includes(permission))
    .map((a) => a.eventId);
}

/**
 * Requires an approved global admin OR an approved account with at least one
 * event assignment. Everyone else is redirected exactly as before.
 */
export async function requireAdminAccess(): Promise<AdminAccess> {
  await requireActiveAccount("/login?next=/admin");
  const access = await getAdminAccess();
  if (!access || (!access.isAdmin && access.assignments.length === 0)) redirect("/");
  return access;
}

/** Requires the area via a global scope or any event assignment. */
export async function requireEventArea(permission: EventPermission): Promise<AdminAccess> {
  const access = await requireAdminAccess();
  if (!hasAreaAccess(access, permission)) redirect("/admin");
  return access;
}

/** Requires an admin with a specific GLOBAL scope; sends others to the overview. */
export async function requireScope(scope: AdminScope): Promise<ProfileRow> {
  const access = await requireAdminAccess();
  if (!hasGlobalScope(access, scope)) redirect("/admin");
  return access.profile;
}

/** Requires the super admin. */
export async function requireSuperAdmin(): Promise<ProfileRow> {
  const access = await requireAdminAccess();
  if (!access.isSuper) redirect("/admin");
  return access.profile;
}
