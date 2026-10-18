import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { Card, StatCard } from "@/components/ui/card";
import { EventThumb } from "@/components/events/category-visual";
import { EmptyState } from "@/components/ui/misc";
import { getEventCollections } from "@/lib/data/collections";
import { requireScope } from "@/lib/auth";
import { EVENT_CATEGORY_LABELS } from "@/lib/constants";
import { formatEventDate, formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Collections" };

export default async function AdminCollectionsPage() {
  await requireScope("payments");
  const { events, totalCollectedPaise, totalExpectedPaise, totalVerified } =
    await getEventCollections();

  const overall =
    totalExpectedPaise > 0
      ? Math.min(100, (totalCollectedPaise / totalExpectedPaise) * 100)
      : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Collections
        </h1>
        <p className="mt-1 text-sm text-muted">
          Amount collected per event — counts approved payments only.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Collected"
          value={formatINR(totalCollectedPaise)}
          tone="success"
          hint="Verified payments"
        />
        <StatCard
          label="Expected"
          value={formatINR(totalExpectedPaise)}
          tone="neutral"
          hint="From all registrants"
        />
        <StatCard
          label="Collected %"
          value={`${Math.round(overall)}%`}
          tone="brand"
        />
        <StatCard label="Paid registrations" value={totalVerified} tone="success" />
      </div>

      {events.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="size-8 text-brand" />}
          title="No events yet"
          description="Create events to start tracking collections."
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {events.map((c) => {
            const free = c.event.registration_fee === 0;
            const remaining = c.expectedPaise - c.collectedPaise;
            return (
              <Card key={c.event.id} className="flex flex-col gap-4 p-5">
                <div className="flex items-center gap-3">
                  <div className="relative size-14 shrink-0 overflow-hidden rounded-xl">
                    <EventThumb
                      src={c.event.thumbnail_image ?? c.event.hero_image}
                      alt={c.event.title}
                      category={c.event.category}
                      sizes="56px"
                    />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-base font-semibold text-foreground">
                      {c.event.title}
                    </h3>
                    <p className="truncate text-xs text-muted">
                      {EVENT_CATEGORY_LABELS[c.event.category]} ·{" "}
                      {formatEventDate(c.event.event_date)}
                    </p>
                  </div>
                </div>

                {free ? (
                  <div className="mt-auto rounded-xl border border-border bg-surface-2/40 p-4 text-center">
                    <p className="font-display text-lg font-semibold text-foreground">
                      Free event
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {c.totalRegistrations} registered
                    </p>
                  </div>
                ) : (
                  <div className="mt-auto space-y-2.5">
                    <div className="flex items-end justify-between gap-2">
                      <div>
                        <p className="font-display text-2xl font-semibold text-success">
                          {formatINR(c.collectedPaise)}
                        </p>
                        <p className="text-xs text-muted">
                          of {formatINR(c.expectedPaise)} expected
                        </p>
                      </div>
                      <span className="font-mono text-sm font-medium text-brand">
                        {Math.round(c.progress)}%
                      </span>
                    </div>

                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-success transition-[width]"
                        style={{ width: `${c.progress}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted">
                      <span className="inline-flex items-center gap-1 text-success">
                        <CheckCircle2 className="size-3.5" />
                        {c.verifiedCount} paid
                      </span>
                      {c.pendingCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-warning">
                          <Clock className="size-3.5" />
                          {c.pendingCount} pending · {formatINR(remaining)}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <Link
                  href={`/admin/registrations?event=${c.event.id}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                >
                  View registrations <ArrowRight className="size-3.5" />
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
