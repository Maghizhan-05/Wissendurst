import type { Metadata } from "next";
import { requireAnalyticsAdmin } from "@/lib/auth";
import { getHeatmap } from "@/lib/data/analytics-dashboard";
import { parseWidth } from "@/lib/analytics/heatmaps";
import { HeatmapViewer } from "@/components/admin/analytics/heatmap-viewer";

export const metadata: Metadata = { title: "Admin · Heatmap" };

/** Saved heatmap viewer (D-026). Analytics admin only (requireAnalyticsAdmin); read-only. */
export default async function HeatmapViewerPage(props: PageProps<"/admin/analytics/heatmaps/[shortId]">) {
  await requireAnalyticsAdmin();
  const { shortId } = await props.params;
  const asked = parseWidth((await props.searchParams).width);
  const detail = await getHeatmap(shortId);
  return <HeatmapViewer detail={detail} asked={asked} />;
}
