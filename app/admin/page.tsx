import type { Metadata } from "next";
import Link from "next/link";
import { TriangleAlert, ArrowRight } from "lucide-react";
import { StatCard } from "@/components/ui/card";
import { getAdminStats } from "@/lib/data/admin";
import { getEventsByIds } from "@/lib/data/event-admin";
import { requireAdminAccess, type AdminAccess } from "@/lib/auth";
import { EVENT_PERMISSION_LABELS } from "@/lib/constants";
import { formatEventDate, formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Overview" };

export default async function AdminOverviewPage() {
  const access = await requireAdminAccess();
  // Accounts that only administer single events see just their events.
  if (!access.isAdmin) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Overview
          </h1>
          <p className="mt-1 text-sm text-muted">The events you administer.</p>
        </div>
        <AssignedEvents access={access} />
      </div>
    );
  }

  const stats = await getAdminStats();
  const maxCount = Math.max(1, ...stats.perEvent.map((e) => e.count));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Overview
        </h1>
        <p className="mt-1 text-sm text-muted">
          Live snapshot of registrations and payments. Registration figures
          count each solo registration or whole team once.
        </p>
      </div>

      {stats.duplicates > 0 && (
        <Link
          href="/admin/payments"
          className="flex items-center justify-between gap-3 rounded-xl border border-alert/30 bg-alert/10 p-4 transition-colors hover:bg-alert/15"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-alert">
            <TriangleAlert className="size-4" />
            {stats.duplicates} duplicate transaction
            {stats.duplicates === 1 ? "" : "s"} need attention
          </span>
          <ArrowRight className="size-4 text-alert" />
        </Link>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Users" value={stats.users} tone="brand" />
        <StatCard label="Registrations" value={stats.registrations} tone="neutral" />
        <StatCard label="Verified" value={stats.verified} tone="success" />
        <StatCard label="Under review" value={stats.underReview} tone="warning" />
        <StatCard label="Duplicates" value={stats.duplicates} tone="alert" />
        <StatCard label="Revenue" value={formatINR(stats.revenuePaise)} tone="success" />
      </div>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-foreground">
            Registrations by event
          </h2>
          <Link
            href="/admin/registrations"
            className="text-sm font-medium text-brand hover:underline"
          >
            View all →
          </Link>
        </div>

        {stats.perEvent.length === 0 ? (
          <p className="mt-6 text-sm text-muted">No registrations yet.</p>
        ) : (
          <ul className="mt-6 space-y-3">
            {stats.perEvent.map((e) => (
              <li key={e.title} className="flex items-center gap-4">
                <span className="w-48 shrink-0 truncate text-sm text-foreground">
                  {e.title}
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${(e.count / maxCount) * 100}%` }}
                  />
                </div>
                <span className="w-8 text-right font-mono text-sm text-muted">
                  {e.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {access.assignments.length > 0 && <AssignedEvents access={access} />}
    </div>
  );
}

/** Per-event assignments of this account (0034), with their entry points. */
async function AssignedEvents({ access }: { access: AdminAccess }) {
  const events = await getEventsByIds(access.assignments.map((a) => a.eventId));
  const permsOf = new Map(access.assignments.map((a) => [a.eventId, a.permissions]));
  return (
    <section aria-labelledby="assigned-events" className="rounded-2xl border border-border bg-surface p-6">
      <h2 id="assigned-events" className="font-display text-lg font-semibold text-foreground">
        Your events
      </h2>
      {events.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No events are assigned to you.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {events.map((e) => {
            const perms = permsOf.get(e.id) ?? [];
            return (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{e.title}</p>
                  <p className="text-xs text-muted">
                    {e.archived_at ? "Archived · " : ""}
                    {e.event_date ? formatEventDate(e.event_date) : "Date TBA"} ·{" "}
                    {perms.map((p) => EVENT_PERMISSION_LABELS[p]).join(", ")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                  {perms.includes("events") && (
                    <>
                      <Link
                        href={`/admin/registrations?event=${e.id}`}
                        className="rounded-lg border border-border px-3 py-1.5 font-medium text-foreground hover:bg-surface-2"
                      >
                        Registrations
                      </Link>
                      <Link
                        href={`/admin/events/${e.id}/edit`}
                        className="rounded-lg border border-border px-3 py-1.5 font-medium text-foreground hover:bg-surface-2"
                      >
                        Edit details
                      </Link>
                    </>
                  )}
                  {perms.includes("payments") && (
                    <Link
                      href="/admin/payments"
                      className="rounded-lg border border-border px-3 py-1.5 font-medium text-foreground hover:bg-surface-2"
                    >
                      Payments
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
