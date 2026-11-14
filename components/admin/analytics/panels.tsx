import Link from "next/link";
import { CircleAlert, KeyRound, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Bucket, RangeDays, Section } from "@/lib/analytics/dashboard";

/**
 * Server-rendered building blocks for /admin/analytics (D-026). Editorial,
 * dense composition on the semantic tokens; the interactive plots live in
 * ./charts (client). No analytics SDK is imported anywhere here.
 */
export const nf = new Intl.NumberFormat("en-IN");
export const pct = (v: number) => `${(v * 100).toFixed(v >= 0.1 || v === 0 ? 0 : 1)}%`;

export function Panel({
  eyebrow,
  title,
  aside,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-2xl border border-border bg-surface p-5 sm:p-6", className)}>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {eyebrow && <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">{eyebrow}</p>}
          <h2 className="mt-1 font-display text-xl font-semibold leading-tight text-foreground">{title}</h2>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function SectionFailed({ what }: { what: string }) {
  return (
    <div className="flex min-h-32 flex-1 items-center gap-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted">
      <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden />
      <span>
        Couldn&rsquo;t load {what} from PostHog right now. Other sections are unaffected; reload to retry.
      </span>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-32 flex-1 items-center justify-center rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export function RangeControl({ range, base = "/admin/analytics" }: { range: RangeDays; base?: string }) {
  return (
    <nav aria-label="Date range" className="inline-flex rounded-full border border-border bg-surface p-1">
      {([7, 30, 90] as const).map((d) => (
        <Link
          key={d}
          href={`${base}?range=${d}`}
          aria-current={d === range ? "page" : undefined}
          className={cn(
            "inline-flex min-h-9 min-w-14 items-center justify-center rounded-full px-3 font-mono text-xs tabular-nums transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            d === range ? "bg-brand text-brand-contrast" : "text-muted hover:text-foreground",
          )}
        >
          {d}d
        </Link>
      ))}
    </nav>
  );
}

export function Notice({
  tone = "warning",
  icon = "settings",
  title,
  children,
}: {
  tone?: "warning" | "alert";
  icon?: "settings" | "key" | "alert";
  title: string;
  children: React.ReactNode;
}) {
  const Icon = icon === "key" ? KeyRound : icon === "alert" ? CircleAlert : Settings2;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <span className={cn("mt-0.5", tone === "alert" ? "text-alert" : "text-warning")}>
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <h2 className="font-display text-base font-semibold text-foreground">{title}</h2>
        <div className="mt-1 space-y-2 text-sm text-muted">{children}</div>
      </div>
    </div>
  );
}

/** Ranked public paths with proportional bars and exact totals. */
export function TopPaths({ section }: { section: Section<{ path: string; views: number }[]> }) {
  if (!section.ok) return <SectionFailed what="top pages" />;
  if (section.data.length === 0) return <Empty>No public page views in this range yet.</Empty>;
  const max = section.data[0].views || 1;
  const total = section.data.reduce((a, p) => a + p.views, 0);
  return (
    <ol className="space-y-3">
      {section.data.map((p, i) => (
        <li key={p.path} className="grid grid-cols-[2rem_1fr_auto] items-baseline gap-x-3">
          <span className="font-mono text-xs tabular-nums text-muted">{String(i + 1).padStart(2, "0")}</span>
          <div className="min-w-0">
            <p className="truncate font-mono text-[13px] text-foreground" title={p.path}>
              {p.path}
            </p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max((p.views / max) * 100, 2)}%` }} />
            </div>
          </div>
          <span className="text-right">
            <span className="font-mono text-sm tabular-nums text-foreground">{nf.format(p.views)}</span>
            <span className="ml-2 font-mono text-[11px] tabular-nums text-muted">{pct(p.views / total)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

const SEGMENTS = ["bg-brand", "bg-brand-2", "bg-warning", "bg-success", "bg-brand/45", "bg-muted/60"];

/** One privacy-safe category breakdown: segmented bar + ranked legend. */
export function Breakdown({ label, section }: { label: string; section: Section<Bucket[]> }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">{label}</p>
      {!section.ok ? (
        <p className="mt-2 text-sm text-muted">Unavailable right now.</p>
      ) : section.data.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No data yet.</p>
      ) : (
        <BreakdownBody buckets={section.data} label={label} />
      )}
    </div>
  );
}

function BreakdownBody({ buckets, label }: { buckets: Bucket[]; label: string }) {
  const total = buckets.reduce((a, b) => a + b.total, 0) || 1;
  const color = (name: string, i: number) => (name === "Other" ? "bg-muted/40" : SEGMENTS[i % SEGMENTS.length]);
  return (
    <>
      <div className="mt-2.5 flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${label} share`}>
        {buckets.map((b, i) => (
          <div key={b.name} className={color(b.name, i)} style={{ width: `${(b.total / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {buckets.map((b, i) => (
          <li key={b.name} className="flex min-w-0 items-center gap-2 text-sm">
            <span aria-hidden className={cn("size-2 shrink-0 rounded-sm", color(b.name, i))} />
            <span className="truncate text-foreground">{b.name}</span>
            <span className="ml-auto font-mono text-xs tabular-nums text-muted">{pct(b.total / total)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function ExceptionTypes({ section }: { section: Section<{ type: string; total: number }[]> }) {
  if (!section.ok) return <SectionFailed what="error types" />;
  if (section.data.length === 0) return <Empty>No error types recorded.</Empty>;
  const max = section.data[0].total || 1;
  return (
    <ul className="space-y-2.5">
      {section.data.map((t) => (
        <li key={t.type}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate font-mono text-[13px] text-foreground" title={t.type}>
              {t.type}
            </span>
            <span className="font-mono text-sm tabular-nums text-foreground">{nf.format(t.total)}</span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full rounded-full bg-alert/80" style={{ width: `${Math.max((t.total / max) * 100, 2)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
