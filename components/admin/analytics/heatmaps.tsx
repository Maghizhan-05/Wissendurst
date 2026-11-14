import Link from "next/link";
import { ArrowUpRight, Flame, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { chooseWidth, type HeatmapList, type SavedHeatmap } from "@/lib/analytics/heatmaps";
import { HeatmapImage } from "./heatmap-image";
import { Empty, Notice } from "./panels";

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export const screenshotSrc = (h: SavedHeatmap, width: number) =>
  `/admin/analytics/heatmaps/${encodeURIComponent(h.shortId)}/screenshot?width=${width}`;

export function StatusBadge({ status }: { status: SavedHeatmap["status"] }) {
  const map = {
    completed: ["Ready", "text-success border-success/30 bg-success/10"],
    processing: ["Rendering", "text-warning border-warning/30 bg-warning/10"],
    failed: ["Render failed", "text-alert border-alert/30 bg-alert/10"],
  } as const;
  const [label, cls] = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", cls)}>
      {status === "processing" && <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />}
      {label}
    </span>
  );
}

/** Missing-scope / rejected / failed states shared by the gallery and viewer. */
export function HeatmapProblem({ state }: { state: Exclude<HeatmapList["state"], "ok"> | "not-found" }) {
  switch (state) {
    case "not-configured":
      return (
        <Notice title="Heatmaps need the dashboard credential">
          <p>Set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID (server-only) to list saved heatmaps.</p>
        </Notice>
      );
    case "missing-scope":
      return (
        <Notice icon="key" title="The PostHog key is missing the heatmap:read scope">
          <p>
            Edit the personal API key in PostHog (Settings → Personal API keys) so it has <code className="font-mono">query:read</code> and{" "}
            <code className="font-mono">heatmap:read</code>, scoped to this project only. No write scopes are needed.
          </p>
        </Notice>
      );
    case "rejected":
      return (
        <Notice tone="alert" icon="alert" title="PostHog rejected the heatmap request">
          <p>The key or project ID was not accepted for heatmaps. Check the key&rsquo;s project access and the project ID.</p>
        </Notice>
      );
    case "no-origin":
      return (
        <Notice title="Site origin unknown">
          <p>Set NEXT_PUBLIC_SITE_URL (or deploy on Vercel) so only this site&rsquo;s saved heatmaps are shown.</p>
        </Notice>
      );
    case "not-found":
      return (
        <Notice title="Heatmap not found">
          <p>It may have been deleted in PostHog, or it belongs to another site or a non-public page.</p>
        </Notice>
      );
    default:
      return (
        <Notice tone="alert" icon="alert" title="Saved heatmaps are unavailable right now">
          <p>PostHog didn&rsquo;t answer as expected. Reload to try again.</p>
        </Notice>
      );
  }
}

export function HeatmapGallery({ list }: { list: HeatmapList }) {
  if (list.state !== "ok") return <HeatmapProblem state={list.state} />;
  if (list.items.length === 0) {
    return (
      <Empty>
        <span className="max-w-md">
          <Flame className="mx-auto mb-2 size-5 text-brand" aria-hidden />
          No saved heatmaps for this site yet. In PostHog open <strong className="text-foreground">Heatmaps</strong>,
          enter a public page URL (e.g. the home page or an event page) and <strong className="text-foreground">Save</strong> it —
          it appears here once its screenshot has rendered.
          {list.hidden > 0 && <span className="mt-2 block">{list.hidden} saved heatmap(s) for other sites or non-public pages are hidden.</span>}
        </span>
      </Empty>
    );
  }
  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.items.map((h) => {
          const w = chooseWidth(h, 1024);
          return (
            <li key={h.id}>
              <Link
                href={`/admin/analytics/heatmaps/${encodeURIComponent(h.shortId)}`}
                className="group block overflow-hidden rounded-xl border border-border bg-surface-2/40 transition-colors duration-150 hover:border-brand/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {w !== null ? (
                  <HeatmapImage src={screenshotSrc(h, w)} alt={`Saved screenshot of ${h.path}`} className="aspect-[16/10] border-b border-border" />
                ) : (
                  <div className="flex aspect-[16/10] items-center justify-center border-b border-border text-sm text-muted">
                    {h.status === "failed" ? "No screenshot (render failed)" : "Screenshot rendering…"}
                  </div>
                )}
                <div className="flex items-start justify-between gap-3 p-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{h.name ?? h.path}</p>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted">{h.path}</p>
                    <p className="mt-1.5 font-mono text-[11px] text-muted">
                      {h.readyWidths.length}/{Math.max(h.targetWidths.length, h.readyWidths.length)} widths
                      {h.updatedAt && ` · ${dateFmt.format(new Date(h.updatedAt))}`}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <StatusBadge status={h.status} />
                    <ArrowUpRight className="size-4 text-muted transition-colors group-hover:text-brand" aria-hidden />
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {list.hidden > 0 && (
        <p className="mt-3 text-xs text-muted">{list.hidden} saved heatmap(s) for other sites or non-public pages are hidden.</p>
      )}
    </>
  );
}
