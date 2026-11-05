"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import { AddButton, ItemControls, moveItem } from "@/components/admin/content-fields";
import { saveEventFilterConfig, type FilterSaveState } from "@/lib/actions/event-filters";
import { activeCategories, type EventCategoryInfo } from "@/lib/events/categories";
import {
  defaultEventFilterConfig,
  MAX_FILTER_GROUPS,
  MAX_FILTER_LABEL,
  MAX_FILTER_SLUG,
  slugifyLabel,
  unassignedCategories,
  validateEventFilterConfig,
  visibleGroups,
  type EventFilterConfig,
  type FilterGroup,
} from "@/lib/events/filter-config";
import { cn } from "@/lib/utils";

/** Re-number positions to match list order (positions are 1-based). */
function renumber(groups: FilterGroup[]): FilterGroup[] {
  return groups.map((g, i) => ({ ...g, position: i + 1 }));
}

function newGroup(existing: FilterGroup[]): FilterGroup {
  let n = existing.length + 1;
  const taken = new Set(existing.flatMap((g) => [g.id, g.slug]));
  while (taken.has(`group-${n}`)) n++;
  return {
    id: `group-${n}`,
    slug: `group-${n}`,
    label: `Group ${n}`,
    enabled: true,
    position: existing.length + 1,
    categories: [],
  };
}

export function EventFiltersEditor({
  initial,
  categories,
}: {
  initial: EventFilterConfig;
  /** Every category, archived included (archived ones can't be newly added). */
  categories: EventCategoryInfo[];
}) {
  const [cfg, setCfg] = useState<EventFilterConfig>(initial);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [state, action, pending] = useActionState<FilterSaveState, FormData>(saveEventFilterConfig, null);
  const allId = useId();

  useEffect(() => {
    if (state?.ok) toast.success(state.message);
    else if (state && !state.ok) toast.error(state.error);
  }, [state]);

  const validation = validateEventFilterConfig(cfg, { categories, previous: initial });
  const unassigned = unassignedCategories(cfg, categories);
  const setGroups = (groups: FilterGroup[]) => setCfg((c) => ({ ...c, groups: renumber(groups) }));
  const patch = (i: number, p: Partial<FilterGroup>) =>
    setGroups(cfg.groups.map((g, j) => (j === i ? { ...g, ...p } : g)));

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="config" value={JSON.stringify(cfg)} />

      {/* Live preview of the public bar */}
      <Card className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-foreground">Preview</h2>
        <div role="group" aria-label="Preview of the public filter bar" className="flex flex-wrap gap-2">
          {[cfg.allLabel || "All", ...visibleGroups(cfg).map((g) => g.label || "(no label)")].map((l, i) => (
            <span
              key={i}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-3.5 py-1.5 text-sm font-medium sm:min-h-0",
                i === 0 ? "border-brand bg-brand text-brand-contrast" : "border-border text-muted",
              )}
            >
              {l}
            </span>
          ))}
        </div>
        {unassigned.length > 0 && (
          <p role="status" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>
              No visible group includes: {unassigned.map((c) => c.label).join(", ")}. Those events are
              still listed under “{cfg.allLabel || "All"}”.
            </span>
          </p>
        )}
      </Card>

      <Card className="space-y-4">
        <div>
          <Label htmlFor={allId}>“All” tab label</Label>
          <Input
            id={allId}
            value={cfg.allLabel}
            maxLength={MAX_FILTER_LABEL}
            onChange={(e) => setCfg((c) => ({ ...c, allLabel: e.target.value }))}
          />
        </div>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-foreground">
            Groups ({cfg.groups.length}/{MAX_FILTER_GROUPS})
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCfg(defaultEventFilterConfig(categories))}
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2"
            >
              Reset to default
            </button>
            <AddButton
              label="Add group"
              disabled={cfg.groups.length >= MAX_FILTER_GROUPS}
              onClick={() => setGroups([...cfg.groups, newGroup(cfg.groups)])}
            />
          </div>
        </div>

        <ol className="space-y-3">
          {cfg.groups.map((g, i) => (
            <GroupRow
              key={g.id}
              group={g}
              categories={categories}
              index={i}
              count={cfg.groups.length}
              confirming={confirmId === g.id}
              onPatch={(p) => patch(i, p)}
              onMove={(a, b) => setGroups(moveItem(cfg.groups, a, b))}
              onAskRemove={() => setConfirmId(g.id)}
              onCancelRemove={() => setConfirmId(null)}
              onRemove={() => {
                setGroups(cfg.groups.filter((x) => x.id !== g.id));
                setConfirmId(null);
              }}
            />
          ))}
        </ol>
      </Card>

      {!validation.ok && (
        <p role="alert" className="rounded-lg border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert">
          Fix before saving: {validation.error}
        </p>
      )}
      <div className="sticky bottom-4 flex justify-end">
        <Button type="submit" loading={pending} disabled={!validation.ok} className="shadow-lg">
          Save filters
        </Button>
      </div>
    </form>
  );
}

function GroupRow({
  group: g,
  categories,
  index,
  count,
  confirming,
  onPatch,
  onMove,
  onAskRemove,
  onCancelRemove,
  onRemove,
}: {
  group: FilterGroup;
  categories: EventCategoryInfo[];
  index: number;
  count: number;
  confirming: boolean;
  onPatch: (p: Partial<FilterGroup>) => void;
  onMove: (from: number, to: number) => void;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemove: () => void;
}) {
  const id = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);
  const active = activeCategories(categories);
  const order = new Map(categories.map((c, i) => [c.id, i]));
  // Archived categories this group still references: shown, removable, not re-addable.
  const archivedHere = categories.filter((c) => c.archived_at && g.categories.includes(c.id));
  const toggleCat = (id: string, on: boolean) =>
    onPatch({
      categories: on
        ? [...g.categories, id].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
        : g.categories.filter((x) => x !== id),
    });

  return (
    <li className={cn("space-y-3 rounded-xl border border-border p-3", !g.enabled && "opacity-70")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">
            {index + 1}. {g.label || "Untitled group"}
          </span>
          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={g.enabled}
              onChange={(e) => onPatch({ enabled: e.target.checked })}
              className="size-4 accent-[var(--brand)]"
            />
            Visible
          </label>
        </div>
        <ItemControls index={index} count={count} itemLabel={`group ${g.label || index + 1}`} onMove={onMove} onRemove={onAskRemove} />
      </div>

      {confirming && (
        <div role="alertdialog" aria-labelledby={`${id}-c`} className="flex flex-wrap items-center gap-3 rounded-lg border border-alert/40 bg-alert/10 p-3 text-sm">
          <span id={`${id}-c`} className="text-foreground">
            Remove “{g.label || "this group"}”? Its events stay listed under All.
          </span>
          <div className="flex gap-2">
            <button ref={cancelRef} type="button" onClick={onCancelRemove} className="rounded-lg border border-border px-3 py-1.5 font-medium text-foreground hover:bg-surface-2">
              Cancel
            </button>
            <button type="button" onClick={onRemove} className="rounded-lg bg-alert px-3 py-1.5 font-medium text-white hover:opacity-90">
              Remove group
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-l`}>Label</Label>
          <Input id={`${id}-l`} value={g.label} maxLength={MAX_FILTER_LABEL} onChange={(e) => onPatch({ label: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${id}-s`}>URL slug</Label>
          <div className="flex gap-2">
            <Input
              id={`${id}-s`}
              value={g.slug}
              maxLength={MAX_FILTER_SLUG}
              spellCheck={false}
              className="font-mono"
              aria-describedby={`${id}-sh`}
              onChange={(e) => onPatch({ slug: e.target.value.toLowerCase() })}
            />
            <button
              type="button"
              onClick={() => onPatch({ slug: slugifyLabel(g.label) })}
              className="shrink-0 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground hover:bg-surface-2"
            >
              From label
            </button>
          </div>
          <p id={`${id}-sh`} className="mt-1 text-xs text-muted">
            Link: /events?category={g.slug || "…"}
          </p>
        </div>
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-foreground">Categories</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {active.map((c) => (
            <label key={c.id} className="inline-flex min-h-11 items-center gap-2 text-sm text-foreground sm:min-h-0">
              <input
                type="checkbox"
                checked={g.categories.includes(c.id)}
                onChange={(e) => toggleCat(c.id, e.target.checked)}
                className="size-4 accent-[var(--brand)]"
              />
              {c.label}
            </label>
          ))}
        </div>
        {archivedHere.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Archived categories in this group">
            {archivedHere.map((c) => (
              <li
                key={c.id}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-border px-2.5 text-sm text-muted sm:min-h-0 sm:py-1"
              >
                <input type="checkbox" checked disabled aria-label={`${c.label} (archived)`} className="size-4" />
                <span>
                  {c.label} <span className="text-xs font-medium uppercase tracking-wide">· Archived</span>
                </span>
                <button
                  type="button"
                  onClick={() => toggleCat(c.id, false)}
                  className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-surface-2"
                >
                  Remove<span className="sr-only"> {c.label} from this group</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {archivedHere.length > 0 && (
          <p className="mt-1 text-xs text-muted">
            Archived categories can stay in this group but can&rsquo;t be added again until restored.
          </p>
        )}
        {g.categories.length === 0 && <p className="mt-1 text-xs text-alert">Choose at least one category.</p>}
      </fieldset>
    </li>
  );
}
