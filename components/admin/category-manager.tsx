"use client";

import { useActionState, useEffect, useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Lock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/field";
import { ConfirmActionDialog } from "@/components/admin/confirm-action-dialog";
import { CATEGORY_ICON } from "@/components/events/category-meta";
import type { AdminActionState } from "@/lib/actions/admin";
import {
  createEventCategory,
  deleteEventCategory,
  reorderEventCategories,
  setEventCategoryArchived,
  updateEventCategory,
} from "@/lib/actions/event-categories";
import {
  CATEGORY_COLORS,
  CATEGORY_COLOR_KEYS,
  CATEGORY_ICON_KEYS,
  CATEGORY_ICON_LABELS,
  FALLBACK_CATEGORY,
  MAX_CATEGORY_LABEL,
  MAX_CATEGORY_SLUG,
  MAX_EVENT_CATEGORIES,
  categoryVisual,
  type CategoryColorKey,
  type CategoryIconKey,
  type EventCategoryInfo,
} from "@/lib/events/categories";
import { slugifyLabel } from "@/lib/events/filter-config";
import { cn } from "@/lib/utils";

export interface CategoryUsage {
  events: number;
  groups: string[];
  homepage: boolean;
}

function useToastState(state: AdminActionState) {
  useEffect(() => {
    if (state?.ok && state.message) toast.success(state.message);
    else if (state && !state.ok) toast.error(state.error);
  }, [state]);
}

/** Preview tile: allowlisted icon on the allowlisted tint (same as event placeholders). */
function Swatch({ icon, color, className }: { icon: CategoryIconKey; color: CategoryColorKey; className?: string }) {
  const Icon = CATEGORY_ICON[icon];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-gradient-to-br to-surface-2",
        CATEGORY_COLORS[color].hue,
        className,
      )}
    >
      <Icon className="size-5 text-brand" strokeWidth={1.5} />
    </span>
  );
}

function StyleFields({
  idPrefix,
  icon,
  color,
  onIcon,
  onColor,
}: {
  idPrefix: string;
  icon: CategoryIconKey;
  color: CategoryColorKey;
  onIcon: (v: CategoryIconKey) => void;
  onColor: (v: CategoryColorKey) => void;
}) {
  return (
    <>
      <div>
        <Label htmlFor={`${idPrefix}-icon`}>Icon</Label>
        <Select id={`${idPrefix}-icon`} name="icon_key" value={icon} onChange={(e) => onIcon(e.target.value as CategoryIconKey)}>
          {CATEGORY_ICON_KEYS.map((k) => (
            <option key={k} value={k}>
              {CATEGORY_ICON_LABELS[k]}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-color`}>Tint</Label>
        <Select id={`${idPrefix}-color`} name="color_key" value={color} onChange={(e) => onColor(e.target.value as CategoryColorKey)}>
          {CATEGORY_COLOR_KEYS.map((k) => (
            <option key={k} value={k}>
              {CATEGORY_COLORS[k].label}
            </option>
          ))}
        </Select>
      </div>
    </>
  );
}

export function CategoryManager({
  categories,
  usage,
  tabSlugs,
}: {
  categories: EventCategoryInfo[];
  usage: Record<string, CategoryUsage>;
  /** Filter-tab slugs (a new category can't reuse one). */
  tabSlugs: string[];
}) {
  const [order, setOrder] = useState(categories.map((c) => c.id));
  const [pending, startTransition] = useTransition();
  // Server data changed (after a save/revalidate): take the new order.
  const serverOrder = categories.map((c) => c.id).join(",");
  const [seenOrder, setSeenOrder] = useState(serverOrder);
  if (seenOrder !== serverOrder) {
    setSeenOrder(serverOrder);
    setOrder(categories.map((c) => c.id));
  }
  const byId = new Map(categories.map((c) => [c.id, c]));
  const list = order.map((id) => byId.get(id)).filter((c): c is EventCategoryInfo => !!c);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    const previous = order;
    setOrder(next);
    startTransition(async () => {
      const r = await reorderEventCategories(next);
      if (r && !r.ok) {
        setOrder(previous);
        toast.error(r.error);
      } else toast.success("Order saved.");
    });
  };

  const active = list.filter((c) => !c.archived_at);
  const archived = list.filter((c) => c.archived_at);

  return (
    <div className="space-y-6">
      <NewCategoryForm
        full={categories.length >= MAX_EVENT_CATEGORIES}
        taken={categories.map((c) => c.slug)}
        tabSlugs={tabSlugs}
      />

      <Card className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-foreground">
          Categories ({active.length} active{archived.length ? `, ${archived.length} archived` : ""} ·{" "}
          {categories.length}/{MAX_EVENT_CATEGORIES})
        </h2>
        <p className="text-sm text-muted">
          The order here is the order of the event form&rsquo;s category list and of the default filter tabs.
        </p>
        <ol className="space-y-3" aria-busy={pending}>
          {list.map((c) => {
            const i = order.indexOf(c.id);
            return (
              <CategoryRow
                key={c.id}
                category={c}
                usage={usage[c.id] ?? { events: 0, groups: [], homepage: false }}
                index={i}
                count={order.length}
                moving={pending}
                onMove={move}
              />
            );
          })}
        </ol>
      </Card>
    </div>
  );
}

function NewCategoryForm({ full, taken, tabSlugs }: { full: boolean; taken: string[]; tabSlugs: string[] }) {
  const id = useId();
  const [state, action, pending] = useActionState<AdminActionState, FormData>(createEventCategory, null);
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [icon, setIcon] = useState<CategoryIconKey>("book-open");
  const [color, setColor] = useState<CategoryColorKey>("violet");
  useToastState(state);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) {
      setLabel("");
      setSlug("");
      setSlugEdited(false);
    }
  }
  const effectiveSlug = slugEdited ? slug : slugifyLabel(label, MAX_CATEGORY_SLUG);
  const clash = taken.includes(effectiveSlug);
  const tabClash = !clash && tabSlugs.includes(effectiveSlug);

  return (
    <Card className="space-y-4">
      <h2 className="font-display text-lg font-semibold text-foreground">Add a category</h2>
      {full ? (
        <p className="text-sm text-muted">The maximum of {MAX_EVENT_CATEGORIES} categories is reached. Delete an unused one first.</p>
      ) : (
        <form action={action} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor={`${id}-label`}>Name</Label>
              <Input
                id={`${id}-label`}
                name="label"
                value={label}
                maxLength={MAX_CATEGORY_LABEL}
                required
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor={`${id}-slug`}>URL slug</Label>
              <Input
                id={`${id}-slug`}
                name="slug"
                value={effectiveSlug}
                maxLength={MAX_CATEGORY_SLUG}
                spellCheck={false}
                required
                className="font-mono"
                aria-describedby={`${id}-slug-hint`}
                aria-invalid={clash || tabClash || undefined}
                onChange={(e) => {
                  setSlugEdited(true);
                  setSlug(e.target.value.toLowerCase());
                }}
              />
              <p id={`${id}-slug-hint`} className={cn("mt-1 text-xs", clash || tabClash ? "text-alert" : "text-muted")}>
                {clash
                  ? "Another category already uses this slug."
                  : tabClash
                    ? "A filter tab uses this slug, so the link would open that tab. Choose another."
                  : `Link: /events?category=${effectiveSlug || "…"} — can't be changed after creating.`}
              </p>
            </div>
            <StyleFields idPrefix={id} icon={icon} color={color} onIcon={setIcon} onColor={setColor} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-sm text-muted">
              <Swatch icon={icon} color={color} /> Preview
            </span>
            <Button type="submit" loading={pending} disabled={!label.trim() || !effectiveSlug || clash || tabClash}>
              Add category
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function CategoryRow({
  category: c,
  usage,
  index,
  count,
  moving,
  onMove,
}: {
  category: EventCategoryInfo;
  usage: CategoryUsage;
  index: number;
  count: number;
  moving: boolean;
  onMove: (from: number, to: number) => void;
}) {
  const id = useId();
  const initial = categoryVisual([c], c.slug);
  const [label, setLabel] = useState(c.label);
  const [icon, setIcon] = useState<CategoryIconKey>(initial.icon);
  const [color, setColor] = useState<CategoryColorKey>(initial.color);
  const [state, action, pending] = useActionState<AdminActionState, FormData>(updateEventCategory, null);
  useToastState(state);
  const dirty = label !== c.label || icon !== c.icon_key || color !== c.color_key;
  const isProtected = c.slug === FALLBACK_CATEGORY;
  const isArchived = Boolean(c.archived_at);
  const deleteBlocker = isProtected
    ? "“Other” is the fallback category and can't be deleted."
    : usage.events > 0
      ? `Used by ${usage.events} event${usage.events === 1 ? "" : "s"} — archive it instead.`
      : usage.groups.length > 0
        ? `Included in filter tab${usage.groups.length === 1 ? "" : "s"} ${usage.groups.map((g) => `“${g}”`).join(", ")} — remove it there first.`
        : usage.homepage
          ? "Linked from the homepage — change that link in Site content first."
          : null;

  return (
    <li className={cn("space-y-3 rounded-xl border border-border p-3", isArchived && "border-dashed opacity-80")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <Swatch icon={icon} color={color} />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
              {c.label}
              {isArchived ? <Badge tone="warning">Archived</Badge> : <Badge tone="success">Active</Badge>}
              {isProtected && (
                <Badge tone="neutral">
                  <Lock className="mr-1 inline size-3" aria-hidden />
                  Protected
                </Badge>
              )}
            </p>
            <p className="font-mono text-xs text-muted">/events?category={c.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={index === 0 || moving}
            onClick={() => onMove(index, index - 1)}
            aria-label={`Move ${c.label} up`}
            className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:text-foreground disabled:opacity-40 sm:size-9"
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            disabled={index === count - 1 || moving}
            onClick={() => onMove(index, index + 1)}
            aria-label={`Move ${c.label} down`}
            className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:text-foreground disabled:opacity-40 sm:size-9"
          >
            <ArrowDown className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <p className="text-xs text-muted">
        {usage.events} event{usage.events === 1 ? "" : "s"}
        {usage.groups.length > 0 && <> · filter tabs: {usage.groups.join(", ")}</>}
        {usage.homepage && <> · linked from the homepage</>}
      </p>

      <form action={action} className="grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="id" value={c.id} />
        <div>
          <Label htmlFor={`${id}-label`}>Name</Label>
          <Input id={`${id}-label`} name="label" value={label} maxLength={MAX_CATEGORY_LABEL} required onChange={(e) => setLabel(e.target.value)} />
        </div>
        <StyleFields idPrefix={id} icon={icon} color={color} onIcon={setIcon} onColor={setColor} />
        <div className="flex justify-end sm:col-span-3">
          <Button type="submit" size="sm" variant="secondary" loading={pending} disabled={!dirty || !label.trim()}>
            Save changes
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {isProtected ? (
          <p className="text-xs text-muted">“Other” is the fallback category: its name and look can change, but it can&rsquo;t be archived or deleted.</p>
        ) : (
          <>
            <ConfirmActionDialog
              action={setEventCategoryArchived}
              fields={{ id: c.id, archived: isArchived ? "false" : "true" }}
              triggerLabel={isArchived ? `Restore ${c.label}` : `Archive ${c.label}`}
              triggerIcon={
                <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                  {isArchived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
                  {isArchived ? "Restore" : "Archive"}
                </span>
              }
              triggerClassName="border border-border px-3 text-foreground hover:bg-surface-2"
              title={isArchived ? `Restore “${c.label}”?` : `Archive “${c.label}”?`}
              description={
                isArchived ? (
                  <p>It becomes selectable again for new events and filter tabs.</p>
                ) : (
                  <>
                    <p>
                      It disappears from the event form and from new filter-tab choices. The {usage.events} event
                      {usage.events === 1 ? "" : "s"} already in it keep it, and old links keep working.
                    </p>
                    <p>Nothing is deleted; you can restore it any time.</p>
                  </>
                )
              }
              confirmLabel={isArchived ? "Restore" : "Archive"}
              tone={isArchived ? "neutral" : "warning"}
            />
            {deleteBlocker ? (
              <button
                type="button"
                disabled
                aria-describedby={`${id}-delete-why`}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-muted opacity-60 sm:min-h-9"
              >
                <Trash2 className="size-4" aria-hidden />
                Delete permanently
              </button>
            ) : (
              <ConfirmActionDialog
                action={deleteEventCategory}
                fields={{ id: c.id }}
                triggerLabel={`Delete ${c.label} permanently`}
                triggerIcon={
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                    <Trash2 className="size-4" aria-hidden />
                    Delete permanently
                  </span>
                }
                triggerClassName="border border-alert/40 px-3 text-alert hover:bg-alert/10"
                title={`Delete “${c.label}” permanently?`}
                description={
                  <p>
                    No event, filter tab or homepage link uses it. This removes it for good and frees the slug
                    “{c.slug}”. This can&rsquo;t be undone.
                  </p>
                }
                confirmLabel="Delete permanently"
                tone="danger"
              />
            )}
            {deleteBlocker && (
              <p id={`${id}-delete-why`} className="text-xs text-muted">
                {deleteBlocker}
              </p>
            )}
          </>
        )}
      </div>
    </li>
  );
}
