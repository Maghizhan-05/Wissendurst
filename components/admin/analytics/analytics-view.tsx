import { BarChart3 } from "lucide-react";
import type { DashboardData, DashboardResult, RangeDays } from "@/lib/analytics/dashboard";
import type { HeatmapList } from "@/lib/analytics/heatmaps";
import { ExceptionsChart, FunnelChart, Sparkline, TrafficChart } from "./charts";
import { Breakdown, ExceptionTypes, Notice, Panel, RangeControl, SectionFailed, TopPaths, nf, pct } from "./panels";
import { HeatmapGallery } from "./heatmaps";

/**
 * The /admin/analytics composition (D-026), rendered from already-loaded,
 * aggregate-only data. Server component; authorization happens in the page.
 */
export function AnalyticsView({
  range,
  result,
  heatmaps,
}: {
  range: RangeDays;
  result: DashboardResult;
  heatmaps: HeatmapList;
}) {
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">Analytics admin · PostHog EU</p>
          <h1 className="mt-1 flex items-center gap-2.5 font-display text-3xl font-semibold tracking-tight text-foreground">
            <BarChart3 className="size-6 text-brand" aria-hidden /> Analytics
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">
            Anonymous, consent-based totals from the six public pages over the last {range} days. Aggregates only;
            visitors, sessions, replays and error details stay in PostHog. Refreshed at most once a minute.
          </p>
        </div>
        <RangeControl range={range} />
      </header>

      {result.state === "not-configured" ? (
        <Notice title="Analytics dashboard not configured">
          <p>
            {result.reason === "missing"
              ? "Set POSTHOG_PERSONAL_API_KEY (a personal API key with query:read and heatmap:read, scoped to this project) and POSTHOG_PROJECT_ID as server environment variables in Vercel, then redeploy."
              : "POSTHOG_PERSONAL_API_KEY or POSTHOG_PROJECT_ID is not in the expected format (phx_… key, numeric project ID). Check the server environment variables."}
          </p>
        </Notice>
      ) : result.state === "missing-scope" ? (
        <Notice icon="key" title={`The PostHog key is missing the ${result.scope} scope`}>
          <p>Edit the personal API key in PostHog so it has query:read and heatmap:read for this project, then reload.</p>
        </Notice>
      ) : result.state === "rejected" ? (
        <Notice tone="alert" icon="alert" title="PostHog rejected the dashboard credentials">
          <p>The personal API key or project ID was not accepted. Create a key with query:read and heatmap:read for this EU project and update the server environment variables.</p>
        </Notice>
      ) : (
        <Dashboard data={result.data} />
      )}

      <Panel eyebrow="Saved in PostHog" title="Heatmaps">
        <HeatmapGallery list={heatmaps} />
      </Panel>
    </div>
  );
}

function Dashboard({ data }: { data: DashboardData }) {
  const daily = data.daily.ok ? data.daily.data.points : [];
  return (
    <>
      <Kpis data={data} daily={daily} />

      <div className="grid gap-6 lg:grid-cols-12">
        <Panel eyebrow="Daily" title="Traffic" className="lg:col-span-8">
          {data.daily.ok ? <TrafficChart points={data.daily.data.points} /> : <SectionFailed what="daily traffic" />}
        </Panel>

        <Panel eyebrow="Registration" title="Funnel" className="lg:col-span-4">
          {!data.funnel.ok ? (
            <SectionFailed what="the registration funnel" />
          ) : (
            <div className="flex flex-1 flex-col">
              <FunnelChart started={data.funnel.data.started} confirmed={data.funnel.data.confirmed} />
              <dl className="mt-5 grid grid-cols-3 divide-x divide-border rounded-xl border border-border">
                <Stat label="Rate" value={data.funnel.data.conversion === null ? "—" : pct(data.funnel.data.conversion)} tone="success" />
                <Stat label="Confirmed" value={nf.format(data.funnel.data.confirmed)} />
                <Stat label="Dropped" value={nf.format(data.funnel.data.dropOff)} tone={data.funnel.data.dropOff > 0 ? "alert" : undefined} />
              </dl>
              <p className="mt-3 text-xs text-muted">
                {data.funnel.data.mode === "funnel"
                  ? "registration_started → free_registration_confirmed, ordered, 14-day conversion window."
                  : "Funnel query unavailable — showing event totals for the same two steps."}
              </p>
            </div>
          )}
        </Panel>

        <Panel eyebrow="Public pages" title="Top paths" className="lg:col-span-7">
          <TopPaths section={data.topPaths} />
        </Panel>

        <Panel
          eyebrow="Audience"
          title="Devices & browsers"
          className="lg:col-span-5"
          aside={<span className="text-xs text-muted">Major names only · &lt; 5 views → Other</span>}
        >
          <div className="space-y-6">
            <Breakdown label="Device" section={data.breakdowns.device} />
            <Breakdown label="Browser" section={data.breakdowns.browser} />
            <Breakdown label="Operating system" section={data.breakdowns.os} />
          </div>
        </Panel>

        <Panel
          eyebrow="Error tracking"
          title="Errors per day"
          className="lg:col-span-7"
          aside={
            data.exceptions.ok ? (
              <span className="font-mono text-sm tabular-nums text-muted">{nf.format(data.exceptions.data.total)} total</span>
            ) : undefined
          }
        >
          {data.exceptions.ok ? <ExceptionsChart points={data.exceptions.data.points} /> : <SectionFailed what="error volume" />}
        </Panel>

        <Panel eyebrow="Error tracking" title="Top error types" className="lg:col-span-5">
          <ExceptionTypes section={data.exceptionTypes} />
        </Panel>
      </div>
    </>
  );
}

function Kpis({ data, daily }: { data: DashboardData; daily: { pageviews: number; sessions: number | null }[] }) {
  if (!data.kpis.ok) return <SectionFailed what="headline totals" />;
  const k = data.kpis.data;
  const conversion = data.funnel.ok ? data.funnel.data.conversion : k.started > 0 ? Math.min(k.confirmed / k.started, 1) : null;
  const cells = [
    { label: "Page views", value: nf.format(k.pageviews), spark: daily.map((d) => d.pageviews), color: "var(--brand)" },
    { label: "Sessions", value: nf.format(k.sessions), spark: daily.map((d) => d.sessions ?? 0), color: "var(--warning)" },
    { label: "Registrations started", value: nf.format(k.started) },
    { label: "Free confirmed", value: nf.format(k.confirmed) },
    { label: "Conversion", value: conversion === null ? "—" : pct(conversion), accent: true },
  ];
  return (
    <section
      aria-label="Headline totals"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3 lg:grid-cols-5"
    >
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={
            "flex min-w-0 flex-col justify-between gap-3 bg-surface p-4 sm:p-5" +
            (i === cells.length - 1 ? " max-sm:col-span-2 sm:max-lg:col-span-2" : "")
          }
        >
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">{c.label}</p>
          <p className={"font-display text-3xl font-semibold tabular-nums leading-none " + (c.accent ? "text-success" : "text-foreground")}>
            {c.value}
          </p>
          <div className="h-8">{c.spark && <Sparkline values={c.spark} color={c.color} />}</div>
        </div>
      ))}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "alert" }) {
  return (
    <div className="p-3">
      <dt className="truncate text-[11px] uppercase tracking-[0.08em] text-muted">{label}</dt>
      <dd className={"mt-1 font-display text-xl font-semibold tabular-nums " + (tone === "success" ? "text-success" : tone === "alert" ? "text-alert" : "text-foreground")}>
        {value}
      </dd>
    </div>
  );
}

