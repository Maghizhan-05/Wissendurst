import type { Metadata } from "next";
import Link from "next/link";
import {
  Plus,
  Pencil,
  Star,
  Trash2,
  Sheet,
  Zap,
  ZapOff,
  CornerDownRight,
  Layers,
} from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { getAllEventsAdmin } from "@/lib/data/admin";
import { deleteEvent, toggleEventFlag } from "@/lib/actions/admin";
import { requireScope } from "@/lib/auth";
import { EVENT_CATEGORY_LABELS } from "@/lib/constants";
import { formatEventDate, formatINR } from "@/lib/utils";
import type { EventRow } from "@/types/database";

export const metadata: Metadata = { title: "Admin · Events" };

export default async function AdminEventsPage() {
  await requireScope("events");
  const events = await getAllEventsAdmin();

  // Nest sub-events under their parent: each parent row is followed by its
  // sub-events (indented); standalone events render on their own.
  const childrenByParent = new Map<string, EventRow[]>();
  for (const e of events) {
    if (e.parent_event_id) {
      const arr = childrenByParent.get(e.parent_event_id) ?? [];
      arr.push(e);
      childrenByParent.set(e.parent_event_id, arr);
    }
  }
  const rows: { event: EventRow; isChild: boolean; childCount: number }[] = [];
  for (const e of events) {
    if (e.parent_event_id) continue; // children are emitted under their parent
    const kids = (childrenByParent.get(e.id) ?? []).sort((a, b) =>
      a.title.localeCompare(b.title),
    );
    rows.push({ event: e, isChild: false, childCount: kids.length });
    for (const k of kids) rows.push({ event: k, isChild: true, childCount: 0 });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Events
          </h1>
          <p className="mt-1 text-sm text-muted">{events.length} total</p>
        </div>
        <ButtonLink href="/admin/events/new" size="sm">
          <Plus className="size-4" /> New event
        </ButtonLink>
      </div>

      {events.length === 0 ? (
        <EmptyState
          title="No events yet"
          description="Create your first event to open registrations."
          action={
            <ButtonLink href="/admin/events/new">
              <Plus className="size-4" /> New event
            </ButtonLink>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border bg-surface-2/50 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Fee</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ event: e, isChild, childCount }) => (
                <tr key={e.id} className="bg-surface hover:bg-surface-2/40">
                  <td className="px-4 py-3">
                    <div className={isChild ? "flex items-start gap-2 pl-5" : ""}>
                      {isChild && (
                        <CornerDownRight className="mt-0.5 size-4 shrink-0 text-muted" />
                      )}
                      <div className="min-w-0">
                        <Link
                          href={`/events/${e.slug}`}
                          className="font-medium text-foreground hover:text-brand"
                        >
                          {e.title}
                        </Link>
                        <p className="text-xs text-muted">/{e.slug}</p>
                        {childCount > 0 && (
                          <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-brand">
                            <Layers className="size-3" /> {childCount} sub-event
                            {childCount === 1 ? "" : "s"}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {EVENT_CATEGORY_LABELS[e.category]}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {formatEventDate(e.event_date)}
                  </td>
                  <td className="px-4 py-3 font-mono text-muted">
                    {e.registration_fee === 0 ? "Free" : formatINR(e.registration_fee)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone={e.is_live ? "success" : "warning"}>
                        {e.is_live ? "Live" : "Coming soon"}
                      </Badge>
                      <Badge tone={e.registration_open ? "success" : "neutral"}>
                        {e.registration_open ? "Open" : "Closed"}
                      </Badge>
                      {e.featured && <Badge tone="brand">Featured</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {!isChild && (
                        <Link
                          href={`/admin/events/new?parent=${e.id}`}
                          title="Add a sub-event"
                          className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-brand"
                        >
                          <Plus className="size-4" />
                        </Link>
                      )}
                      <form action={toggleEventFlag}>
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="field" value="is_live" />
                        <input type="hidden" name="value" value={String(e.is_live)} />
                        <button
                          type="submit"
                          title={e.is_live ? "Set to Coming soon" : "Make live"}
                          className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-success"
                        >
                          {e.is_live ? (
                            <Zap className="size-4 fill-success/20 text-success" />
                          ) : (
                            <ZapOff className="size-4" />
                          )}
                        </button>
                      </form>
                      <form action={toggleEventFlag}>
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="field" value="featured" />
                        <input type="hidden" name="value" value={String(e.featured)} />
                        <button
                          type="submit"
                          title="Toggle featured"
                          className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-brand"
                        >
                          <Star className={e.featured ? "size-4 fill-brand text-brand" : "size-4"} />
                        </button>
                      </form>
                      <a
                        href={`/admin/events/${e.id}/export`}
                        title="Export participants (Excel)"
                        className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-success"
                      >
                        <Sheet className="size-4" />
                      </a>
                      <Link
                        href={`/admin/events/${e.id}/edit`}
                        title="Edit"
                        className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-foreground"
                      >
                        <Pencil className="size-4" />
                      </Link>
                      <form action={deleteEvent}>
                        <input type="hidden" name="id" value={e.id} />
                        <button
                          type="submit"
                          title="Delete event"
                          className="rounded-md p-2 text-muted hover:bg-alert/10 hover:text-alert"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
