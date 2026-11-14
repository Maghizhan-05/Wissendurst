import "server-only";
import {
  loadDashboard,
  parseDashboardConfig,
  type DashboardConfig,
  type DashboardResult,
  type FetchLike,
  type RangeDays,
} from "@/lib/analytics/dashboard";
import {
  fetchScreenshot,
  getSavedHeatmap,
  listSavedHeatmaps,
  siteOrigins,
  type HeatmapDetail,
  type HeatmapList,
  type ScreenshotResult,
} from "@/lib/analytics/heatmaps";

/**
 * Server-only loaders for /admin/analytics (D-025, D-026). The private
 * PostHog key and project ID are read from server env (never NEXT_PUBLIC_)
 * and never leave the server; pages receive aggregates and safe heatmap
 * metadata only, and screenshots are streamed through the super-admin proxy.
 */
function env() {
  return {
    POSTHOG_PERSONAL_API_KEY: process.env.POSTHOG_PERSONAL_API_KEY,
    POSTHOG_PROJECT_ID: process.env.POSTHOG_PROJECT_ID,
  };
}

function config(): DashboardConfig | null {
  const cfg = parseDashboardConfig(env());
  return cfg.ok ? cfg.config : null;
}

function origins(): string[] {
  return siteOrigins({
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  });
}

const serverFetch = fetch as unknown as FetchLike;

export async function getAnalyticsDashboard(range: RangeDays): Promise<DashboardResult> {
  try {
    return await loadDashboard(env(), range, serverFetch);
  } catch {
    return { state: "rejected", range };
  }
}

export async function getHeatmapList(): Promise<HeatmapList> {
  try {
    return await listSavedHeatmaps(config(), origins(), serverFetch);
  } catch {
    return { state: "failed" };
  }
}

export async function getHeatmap(shortId: string): Promise<HeatmapDetail> {
  try {
    return await getSavedHeatmap(config(), origins(), shortId, serverFetch);
  } catch {
    return { state: "failed" };
  }
}

/** Screenshot bytes for an already-validated, visible heatmap. */
export async function getHeatmapScreenshot(id: string, width: number): Promise<ScreenshotResult> {
  const cfg = config();
  if (!cfg) return { kind: "failed" };
  try {
    return await fetchScreenshot(cfg, id, width, serverFetch);
  } catch {
    return { kind: "failed" };
  }
}
