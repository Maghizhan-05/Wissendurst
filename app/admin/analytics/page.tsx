import type { Metadata } from "next";
import { requireSuperAdmin } from "@/lib/auth";
import { getAnalyticsDashboard, getHeatmapList } from "@/lib/data/analytics-dashboard";
import { parseRange } from "@/lib/analytics/dashboard";
import { AnalyticsView } from "@/components/admin/analytics/analytics-view";

export const metadata: Metadata = { title: "Admin · Analytics" };

/**
 * Super-admin analytics (D-025, D-026). Aggregates only, read server-side
 * from PostHog Cloud EU (short Data Cache, no client polling) — no visitors,
 * IDs, sessions, replays or raw exceptions. This page loads no client
 * analytics SDK; the admin layout never mounts one.
 */
export default async function AdminAnalyticsPage(props: PageProps<"/admin/analytics">) {
  await requireSuperAdmin();
  const range = parseRange((await props.searchParams).range);
  const [result, heatmaps] = await Promise.all([getAnalyticsDashboard(range), getHeatmapList()]);
  return <AnalyticsView range={range} result={result} heatmaps={heatmaps} />;
}
