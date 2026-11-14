import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";

/**
 * Retired (0035: approval-free sign-up). Old links land on the profile's
 * real next step: finishing sign-up, or the dashboard.
 */
export default async function RetiredPendingApprovalPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  redirect(profile.approval_status === "approved" ? "/dashboard" : "/application");
}
