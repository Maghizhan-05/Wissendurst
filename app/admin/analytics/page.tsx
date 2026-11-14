import type { Metadata } from "next";
import { BarChart3, CircleAlert, Settings2 } from "lucide-react";
import { Card, StatCard } from "@/components/ui/card";
import { requireSuperAdmin } from "@/lib/auth";
import { getAnalyticsDashboard } from "@/lib/data/analytics-dashboard";
import type { DashboardData, Section } from "@/lib/analytics/dashboard";

export const metadata: Metadata = { title: "Admin · Analytics" };
export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("en-IN");

/**
 * Super-admin analytics (D-025). Aggregates only, read server-side from
 * PostHog Cloud EU — no visitors, IDs, sessions, replays or raw exceptions.
 * This page loads no client analytics SDK (the admin layout never mounts one).
 */
export default async function AdminAnalyticsPage() {
  await requireSuperAdmin();
  const result = await getAnalyticsDashboard();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-foreground">
          <BarChart3 className="size-5 text-brand" aria-hidden /> Analytics
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Anonymous, consent-based totals from the public pages over the last{" "}
          {result.state === "ok" ? result.windowDays : 30} days. Individual visitors, sessions,
          replays and error details stay in the PostHog console.
        </p>
      </div>

      {result.state === "not-configured" ? (
        <Notice
          icon={<Settings2 className="size-5" aria-hidden />}
          title="Analytics dashboard not configured"
          body={
            result.reason === "missing"
              ? "Set POSTHOG_PERSONAL_API_KEY (a read-only personal API key with query:read) and POSTHOG_PROJECT_ID as server environment variables in Vercel, then redeploy."
              : "POSTHOG_PERSONAL_API_KEY or POSTHOG_PROJECT_ID is not in the expected format (phx_… key, numeric project ID). Check the server environment variables."
          }
        />
      ) : result.state === "rejected" ? (
        <Notice
          icon={<CircleAlert className="size-5" aria-hidden />}
          title="PostHog rejected the dashboard credentials"
          body="The personal API key or project ID was not accepted (or PostHog is unreachable). Create a key with query:read for this EU project and update the server environment variables."
        />
      ) : (
        <Dashboard data={result.data} />
      )}
    </div>
  );
}

function Dashboard({ data }: { data: DashboardData }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Page views" value={stat(data.traffic, (d) => d.pageviews)} />
        <StatCard label="Sessions" value={stat(data.traffic, (d) => d.sessions)} tone="neutral" />
        <StatCard
          label="Registrations started"
          value={stat(data.funnel, (d) => d.started)}
          tone="neutral"
        />
        <StatCard
          label="Free registrations confirmed"
          value={stat(data.funnel, (d) => d.confirmed)}
          tone="success"
          hint={
            data.funnel.ok && data.funnel.data.rate !== null
              ? `${Math.round(data.funnel.data.rate * 100)}% of started`
              : undefined
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-lg font-semibold text-foreground">Top public pages</h2>
          {!data.topPaths.ok ? (
            <Unavailable />
          ) : data.topPaths.data.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No page views yet.</p>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="pb-2 font-medium">Path</th>
                  <th className="pb-2 text-right font-medium">Views</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.topPaths.data.map((p) => (
                  <tr key={p.path}>
                    <td className="py-2 font-mono text-xs text-foreground">{p.path}</td>
                    <td className="py-2 text-right tabular-nums text-foreground">{nf.format(p.views)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-lg font-semibold text-foreground">Errors</h2>
            <span className="text-sm text-muted">
              {data.exceptions.ok ? `${nf.format(data.exceptions.data.total)} total` : "—"}
            </span>
          </div>
          {!data.exceptionTypes.ok ? (
            <Unavailable />
          ) : data.exceptionTypes.data.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No errors reported.</p>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 text-right font-medium">Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.exceptionTypes.data.map((t) => (
                  <tr key={t.type}>
                    <td className="break-all py-2 font-mono text-xs text-foreground">{t.type}</td>
                    <td className="py-2 text-right tabular-nums text-foreground">{nf.format(t.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}

function stat<T>(s: Section<T>, pick: (d: T) => number): string {
  return s.ok ? nf.format(pick(s.data)) : "—";
}

function Unavailable() {
  return <p className="mt-3 text-sm text-muted">Couldn&rsquo;t load this from PostHog right now.</p>;
}

function Notice({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Card className="flex items-start gap-3">
      <span className="mt-0.5 text-warning">{icon}</span>
      <div>
        <h2 className="font-display text-base font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted">{body}</p>
      </div>
    </Card>
  );
}
