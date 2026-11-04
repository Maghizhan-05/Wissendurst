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
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { getAllEventsAdmin, getEventIdsWithHistory } from "@/lib/data/admin";
import {
  deleteEvent,
  setEventArchived,
  toggleEventFlag,
} from "@/lib/actions/admin";
import { ConfirmActionDialog } from "@/components/admin/confirm-action-dialog";
import { requireScope } from "@/lib/auth";
import { EVENT_CATEGORY_LABELS } from "@/lib/constants";
import { formatEventDate, formatINR } from "@/lib/utils";
import type { EventRow } from "@/types/database";

export const metadata: Metadata = { title: "Admin · Events" };

type EventListRow = {
  event: EventRow;
  depth: number;
  childCount: number;
  /** This event or any sub-event has registration/team/payment history. */
  hasHistory: boolean;
  /** Archived itself while its parent is not (the restorable unit). */
  archiveRoot: boolean;
  /** All sub-events below it (any depth, active or archived). */
  descendants: number;
};

export default async function AdminEventsPage() {
  await requireScope("events");
  const [events, historyIds] = await Promise.all([
    getAllEventsAdmin(),
    getEventIdsWithHistory(),
  ]);
  const historyUnknown = historyIds.has("*");
  const byId = new Map(events.map((e) => [e.id, e]));

  // Nest sub-events under their parent (up to three tiers): each event row is
  // followed by its sub-events, indented by depth.
  const childrenByParent = new Map<string, EventRow[]>();
  for (const e of events) {
    if (e.parent_event_id) {
      const arr = childrenByParent.get(e.parent_event_id) ?? [];
      arr.push(e);
      childrenByParent.set(e.parent_event_id, arr);
    }
  }

  // History rolls up the tree: a parent with a used sub-event is "used" too.
  const historyMemo = new Map<string, boolean>();
  const subtreeHasHistory = (id: string, seen = new Set<string>()): boolean => {
    const cached = historyMemo.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return false;
    seen.add(id);
    const used =
      historyUnknown ||
      historyIds.has(id) ||
      (childrenByParent.get(id) ?? []).some((k) => subtreeHasHistory(k.id, seen));
    historyMemo.set(id, used);
    return used;
  };

  const countDescendants = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    return (childrenByParent.get(id) ?? []).reduce(
      (n, k) => n + 1 + countDescendants(k.id, seen),
      0,
    );
  };

  const buildRows = (archived: boolean): EventListRow[] => {
    const inSet = (e: EventRow) => Boolean(e.archived_at) === archived;
    const rows: EventListRow[] = [];
    const emit = (e: EventRow, depth: number) => {
      const kids = (childrenByParent.get(e.id) ?? [])
        .filter(inSet)
        .sort((a, b) => a.title.localeCompare(b.title));
      const parent = e.parent_event_id ? byId.get(e.parent_event_id) : undefined;
      rows.push({
        event: e,
        depth,
        childCount: kids.length,
        hasHistory: subtreeHasHistory(e.id),
        archiveRoot: Boolean(e.archived_at) && !parent?.archived_at,
        descendants: countDescendants(e.id),
      });
      for (const k of kids) emit(k, depth + 1);
    };
    for (const e of events) {
      if (!inSet(e)) continue;
      const parent = e.parent_event_id ? byId.get(e.parent_event_id) : undefined;
      // Roots of this section: no parent, or a parent in the other section.
      if (!parent || !inSet(parent)) emit(e, 0);
    }
    return rows;
  };

  const activeRows = buildRows(false);
  const archivedRows = buildRows(true);
  const MAX_DEPTH = 2; // event(0) → sub(1) → sub-sub(2)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Events
          </h1>
          <p className="mt-1 text-sm text-muted">
            {activeRows.length} active
            {archivedRows.length > 0 && ` · ${archivedRows.length} archived`}
          </p>
        </div>
        <ButtonLink href="/admin/events/new" size="sm">
          <Plus className="size-4" /> New event
        </ButtonLink>
      </div>

      {activeRows.length === 0 ? (
        <EmptyState
          title="No active events"
          description="Create your first event to open registrations."
          action={
            <ButtonLink href="/admin/events/new">
              <Plus className="size-4" /> New event
            </ButtonLink>
          }
        />
      ) : (
        <EventTable rows={activeRows} maxDepth={MAX_DEPTH} />
      )}

      {archivedRows.length > 0 && (
        <section aria-labelledby="archived-events-heading" className="space-y-3">
          <div>
            <h2
              id="archived-events-heading"
              className="font-display text-lg font-semibold text-foreground"
            >
              Archived
            </h2>
            <p className="mt-1 text-sm text-muted">
              Hidden from the public site and closed to registration. Their
              registrations, payments and exports are kept.
            </p>
          </div>
          <EventTable rows={archivedRows} maxDepth={MAX_DEPTH} />
        </section>
      )}
    </div>
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function EventTable({
  rows,
  maxDepth,
}: {
  rows: EventListRow[];
  maxDepth: number;
}) {
  return (
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
          {rows.map(
            ({ event: e, depth, childCount, hasHistory, archiveRoot, descendants }) => {
            const archived = Boolean(e.archived_at);
            return (
              <tr key={e.id} className="bg-surface hover:bg-surface-2/40">
                <td className="px-4 py-3">
                  <div
                    className="flex items-start gap-2"
                    style={{ paddingLeft: depth * 20 }}
                  >
                    {depth > 0 && (
                      <CornerDownRight className="mt-0.5 size-4 shrink-0 text-muted" />
                    )}
                    <div className="min-w-0">
                      <Link
                        href={archived ? `/admin/events/${e.id}/edit` : `/events/${e.slug}`}
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
                    {archived ? (
                      <Badge tone="neutral">Archived</Badge>
                    ) : (
                      <>
                        <Badge tone={e.is_live ? "success" : "warning"}>
                          {e.is_live ? "Live" : "Coming soon"}
                        </Badge>
                        <Badge tone={e.registration_open ? "success" : "neutral"}>
                          {e.registration_open ? "Open" : "Closed"}
                        </Badge>
                        {e.featured && <Badge tone="brand">Featured</Badge>}
                      </>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {!archived && depth < maxDepth && (
                      <Link
                        href={`/admin/events/new?parent=${e.id}`}
                        title="Add a sub-event"
                        aria-label={`Add a sub-event to ${e.title}`}
                        className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-brand"
                      >
                        <Plus className="size-4" />
                      </Link>
                    )}
                    {!archived && (
                      <>
                        <form action={toggleEventFlag}>
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="field" value="is_live" />
                          <input type="hidden" name="value" value={String(e.is_live)} />
                          <button
                            type="submit"
                            title={e.is_live ? "Set to Coming soon" : "Make live"}
                            aria-label={e.is_live ? "Set to Coming soon" : "Make live"}
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
                            aria-label="Toggle featured"
                            aria-pressed={e.featured}
                            className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-brand"
                          >
                            <Star className={e.featured ? "size-4 fill-brand text-brand" : "size-4"} />
                          </button>
                        </form>
                      </>
                    )}
                    <a
                      href={`/admin/events/${e.id}/export`}
                      title="Export participants (Excel)"
                      aria-label={`Export participants of ${e.title} (Excel)`}
                      className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-success"
                    >
                      <Sheet className="size-4" />
                    </a>
                    <Link
                      href={`/admin/events/${e.id}/edit`}
                      title="Edit"
                      aria-label={`Edit ${e.title}`}
                      className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-foreground"
                    >
                      <Pencil className="size-4" />
                    </Link>
                    {!archived && (
                      <ConfirmActionDialog
                        action={setEventArchived}
                        fields={{ id: e.id, archive: "true" }}
                        triggerLabel={`Archive ${e.title}`}
                        triggerIcon={<Archive className="size-4" />}
                        triggerClassName="hover:bg-warning/10 hover:text-warning"
                        tone="warning"
                        title={`Archive “${e.title}”?`}
                        confirmLabel="Archive event"
                        description={
                          <>
                            <p>
                              It will be hidden from the public site, unfeatured and
                              closed to new registrations
                              {descendants > 0 &&
                                ` — together with its ${plural(descendants, "sub-event")}`}
                              .
                            </p>
                            <p>
                              Existing registrations, payments and exports stay
                              available to admins. You can restore it later.
                            </p>
                          </>
                        }
                      />
                    )}
                    {archived && archiveRoot && (
                      <ConfirmActionDialog
                        action={setEventArchived}
                        fields={{ id: e.id, archive: "false" }}
                        triggerLabel={`Restore ${e.title}`}
                        triggerIcon={<ArchiveRestore className="size-4" />}
                        triggerClassName="hover:bg-surface-2 hover:text-brand"
                        tone="neutral"
                        title={`Restore “${e.title}”?`}
                        confirmLabel="Restore event"
                        description={
                          <p>
                            It will reappear on the public site with any sub-events
                            archived together with it. Registration stays closed
                            until you reopen it.
                          </p>
                        }
                      />
                    )}
                    {!hasHistory && (
                      <ConfirmActionDialog
                        action={deleteEvent}
                        fields={{ id: e.id }}
                        triggerLabel={`Delete ${e.title} permanently`}
                        triggerIcon={<Trash2 className="size-4" />}
                        triggerClassName="hover:bg-alert/10 hover:text-alert"
                        tone="danger"
                        title={`Delete “${e.title}” permanently?`}
                        confirmLabel="Delete permanently"
                        description={
                          <>
                            <p>
                              This event has no registrations or payments. Deleting
                              it removes it for good
                              {descendants > 0 &&
                                `, along with its ${plural(descendants, "sub-event")}`}
                              . This can’t be undone.
                            </p>
                          </>
                        }
                      />
                    )}
                  </div>
                </td>
              </tr>
            );
            },
          )}
        </tbody>
      </table>
    </div>
  );
}
