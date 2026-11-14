/**
 * Analytics authorization identity (D-026 user correction). Pure.
 *
 * Analytics is NOT available to every super admin. Only the one profile that
 * is an admin (role = 'admin'), a super admin (is_super_admin = true) AND
 * holds the participant ID exactly 'supadmin/01' may see the sidebar link,
 * /admin/analytics, its heatmap pages and the screenshot route. The literal
 * is the user-approved authorization identity (accepted tradeoff: staff IDs
 * are reusable display IDs). This module is the ONLY place it may appear;
 * the server gate is requireAnalyticsAdmin() in lib/auth.ts.
 */
export const ANALYTICS_ADMIN_PARTICIPANT_ID = "supadmin/01";

export interface AnalyticsAdminCandidate {
  role?: string | null;
  is_super_admin?: boolean | null;
  participant_id?: string | null;
}

/** Exact match on all three requirements (no trimming, no case folding). */
export function isAnalyticsAdminProfile(profile: AnalyticsAdminCandidate | null | undefined): boolean {
  return (
    !!profile &&
    profile.role === "admin" &&
    profile.is_super_admin === true &&
    profile.participant_id === ANALYTICS_ADMIN_PARTICIPANT_ID
  );
}
