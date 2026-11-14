import "server-only";
import { loadDashboard, type DashboardResult, type FetchLike } from "@/lib/analytics/dashboard";

/**
 * Server-only loader for /admin/analytics (D-025). The private PostHog key
 * and project ID are read from server env (never NEXT_PUBLIC_) and never
 * leave the server; the page receives aggregates only.
 */
export async function getAnalyticsDashboard(): Promise<DashboardResult> {
  try {
    return await loadDashboard(
      {
        POSTHOG_PERSONAL_API_KEY: process.env.POSTHOG_PERSONAL_API_KEY,
        POSTHOG_PROJECT_ID: process.env.POSTHOG_PROJECT_ID,
      },
      fetch as unknown as FetchLike,
    );
  } catch {
    return { state: "rejected" };
  }
}
