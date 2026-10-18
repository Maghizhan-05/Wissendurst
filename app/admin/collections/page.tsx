import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock, Layers } from "lucide-react";
import { Card, StatCard } from "@/components/ui/card";
import { EventThumb } from "@/components/events/category-visual";
import { EmptyState } from "@/components/ui/misc";
import {
  getEventCollections,
  type CollectionGroup,
  type EventCollection,
} from "@/lib/data/collections";
import { requireScope } from "@/lib/auth";
import { EVENT_CATEGORY_LABELS } from "@/lib/constants";
import { formatEventDate, formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · Collections" };

export default async function AdminCollectionsPage() {
  await requireScope("payments");
  const { groups, totalCollectedPaise, totalExpectedPaise, totalVerified } =
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
          Amount collected per event — counts approved payments only. Broader
          events roll up their sub-events.
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

      {groups.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="size-8 text-brand" />}
          title="No events yet"
          description="Create events to start tracking collections."
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <GroupCard key={g.event.id} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupCard({ group: g }: { group: CollectionGroup }) {
  const free = g.expectedPaise === 0;
  const remaining = g.expectedPaise - g.collectedPaise;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <div className="relative size-14 shrink-0 overflow-hidden rounded-xl">
          <EventThumb
            src={g.event.thumbnail_image ?? g.event.hero_image}
            alt={g.event.title}
            category={g.event.category}
            sizes="56px"
          />
        </div>
        <div className="min-w-0">
          <h3 className="truncate font-display text-base font-semibold text-foreground">
            {g.event.title}
          </h3>
          <p className="flex items-center gap-1 truncate text-xs text-muted">
            {EVENT_CATEGORY_LABELS[g.event.category]}
            {g.isContainer ? (
              <>
                {" · "}
                <Layers className="size-3" /> {g.children.length} sub-events
              </>
            ) : (
              <>
                {" · "}
                {formatEventDate(g.event.event_date)}
              </>
            )}
          </p>
        </div>
      </div>

      {free ? (
        <div className="mt-auto rounded-xl border border-border bg-surface-2/40 p-4 text-center">
          <p className="font-display text-lg font-semibold text-foreground">
            Free {g.isContainer ? "events" : "event"}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {g.totalRegistrations} registered
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="font-display text-2xl font-semibold text-success">
                {formatINR(g.collectedPaise)}
              </p>
              <p className="text-xs text-muted">
                of {formatINR(g.expectedPaise)} expected
              </p>
            </div>
            <span className="font-mono text-sm font-medium text-brand">
              {Math.round(g.progress)}%
            </span>
          </div>

          <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-success transition-[width]"
              style={{ width: `${g.progress}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-xs text-muted">
            <span className="inline-flex items-center gap-1 text-success">
              <CheckCircle2 className="size-3.5" />
              {g.verifiedCount} paid
            </span>
            {g.pendingCount > 0 && (
              <span className="inline-flex items-center gap-1 text-warning">
                <Clock className="size-3.5" />
                {g.pendingCount} pending · {formatINR(remaining)}
              </span>
            )}
          </div>
        </div>
      )}

      {g.isContainer && (
        <div className="space-y-2 border-t border-border pt-3">
          {g.children.map((c) => (
            <SubRow key={c.event.id} c={c} />
          ))}
        </div>
      )}

      {!g.isContainer && (
        <Link
          href={`/admin/registrations?event=${g.event.id}`}
          className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
        >
          View registrations <ArrowRight className="size-3.5" />
        </Link>
      )}
    </Card>
  );
}

function SubRow({ c }: { c: EventCollection }) {
  const free = c.expectedPaise === 0;
  return (
    <Link
      href={`/admin/registrations?event=${c.event.id}`}
      className="block rounded-lg px-1 py-1.5 transition-colors hover:bg-surface-2/50"
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-medium text-foreground">
          {c.event.title}
        </span>
        <span className="shrink-0 font-mono text-muted">
          {free ? (
            `${c.totalRegistrations} reg`
          ) : (
            <>
              <span className="text-success">{formatINR(c.collectedPaise)}</span>
              <span className="text-muted">/{formatINR(c.expectedPaise)}</span>
            </>
          )}
        </span>
      </div>
      {!free && (
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-success"
            style={{ width: `${c.progress}%` }}
          />
        </div>
      )}
    </Link>
  );
}
