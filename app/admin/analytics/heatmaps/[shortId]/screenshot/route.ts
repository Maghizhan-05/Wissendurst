import type { NextRequest } from "next/server";
import { requireAnalyticsAdmin } from "@/lib/auth";
import { getHeatmap, getHeatmapScreenshot } from "@/lib/data/analytics-dashboard";
import { screenshotProxy } from "@/lib/analytics/heatmap-proxy";

/**
 * GET /admin/analytics/heatmaps/:shortId/screenshot?width=1024 (D-026).
 * Analytics admin only (requireAnalyticsAdmin); streams the saved-heatmap screenshot from PostHog with
 * the server-side key. Private caching only; generic errors.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/admin/analytics/heatmaps/[shortId]/screenshot">,
) {
  const { shortId } = await ctx.params;
  return screenshotProxy(
    { shortId, width: request.nextUrl.searchParams.get("width") },
    { authorize: requireAnalyticsAdmin, getHeatmap, getScreenshot: getHeatmapScreenshot },
  );
}
