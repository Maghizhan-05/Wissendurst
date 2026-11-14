import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { chooseWidth, type HeatmapDetail } from "@/lib/analytics/heatmaps";
import { HeatmapImage } from "./heatmap-image";
import { HeatmapProblem, StatusBadge, screenshotSrc } from "./heatmaps";
import { Empty } from "./panels";

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Saved heatmap viewer (D-026): the PostHog-rendered page screenshot at a
 * chosen viewport width, served through the super-admin proxy. Read-only;
 * click/scroll density overlays remain in PostHog until their live API
 * contract is verified. Server component; authorization happens in the page.
 */
export function HeatmapViewer({ detail, asked }: { detail: HeatmapDetail; asked: number | null }) {
  return (
    <div className="space-y-6">
      <Link
        href="/admin/analytics"
        className="inline-flex min-h-9 items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Analytics
      </Link>

      {detail.state !== "ok" ? (
        <HeatmapProblem state={detail.state} />
      ) : (
        (() => {
          const h = detail.heatmap;
          const width = chooseWidth(h, asked);
          return (
            <>
              <header className="flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">Saved heatmap</p>
                  <h1 className="mt-1 truncate font-display text-3xl font-semibold tracking-tight text-foreground">{h.name ?? h.path}</h1>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                    <span className="font-mono">{h.path}</span>
                    <StatusBadge status={h.status} />
                    {h.updatedAt && <span>Updated {dateFmt.format(new Date(h.updatedAt))}</span>}
                  </p>
                </div>
                {h.readyWidths.length > 0 && (
                  <nav aria-label="Viewport width" className="flex flex-wrap gap-1.5">
                    {h.readyWidths.map((w) => (
                      <Link
                        key={w}
                        href={`/admin/analytics/heatmaps/${encodeURIComponent(h.shortId)}?width=${w}`}
                        aria-current={w === width ? "page" : undefined}
                        className={cn(
                          "inline-flex min-h-9 items-center rounded-full border px-3 font-mono text-xs tabular-nums transition-colors duration-150",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          w === width
                            ? "border-brand bg-brand text-brand-contrast"
                            : "border-border text-muted hover:border-brand/50 hover:text-foreground",
                        )}
                      >
                        {w}px
                      </Link>
                    ))}
                  </nav>
                )}
              </header>

              <p className="flex items-start gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
                <Info className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                Rendered page screenshot from PostHog. Click and scroll-depth overlays are viewed in PostHog for now — they
                will be added here once their live data format has been verified.
              </p>

              {width === null ? (
                <Empty>
                  {h.status === "failed"
                    ? "PostHog could not render this page. Regenerate the heatmap in PostHog."
                    : "The screenshot is still rendering in PostHog. Reload in a minute."}
                </Empty>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-border bg-surface p-2 sm:p-3">
                  <HeatmapImage
                    key={width}
                    src={screenshotSrc(h, width)}
                    alt={`Saved screenshot of ${h.path} at ${width}px`}
                    fit="full"
                    className="mx-auto rounded-xl"
                  />
                  <p className="px-1 pt-2 text-right font-mono text-[11px] text-muted">{width}px viewport</p>
                </div>
              )}
            </>
          );
        })()
      )}
    </div>
  );
}
