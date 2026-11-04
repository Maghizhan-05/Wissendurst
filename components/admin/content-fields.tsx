"use client";

import { useId } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/field";
import { isSafeHref } from "@/lib/content/validation";

/* Shared building blocks for the admin content editors. */

export function EditorSection({
  title,
  hint,
  visible,
  onVisibleChange,
  children,
}: {
  title: string;
  hint?: string;
  /** When provided, shows a "Show on page" switch for the section. */
  visible?: boolean;
  onVisibleChange?: (v: boolean) => void;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
        </div>
        {onVisibleChange && (
          <label htmlFor={id} className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              id={id}
              type="checkbox"
              checked={visible}
              onChange={(e) => onVisibleChange(e.target.checked)}
              className="size-4 accent-[var(--brand)]"
            />
            Show on page
          </label>
        )}
      </div>
      <div className={visible === false ? "space-y-4 opacity-60" : "space-y-4"}>{children}</div>
    </Card>
  );
}

export function TextField({
  label,
  value,
  onChange,
  textarea,
  rows = 3,
  maxLength,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      {textarea ? (
        <Textarea
          id={id}
          value={value}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          id={id}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Link destination input with the same allowlist the server enforces. */
export function LinkField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const ok = isSafeHref(value);
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        maxLength={300}
        placeholder="/events or https://…"
        aria-invalid={!ok || undefined}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}-hint`} className={ok ? "mt-1 text-xs text-muted" : "mt-1 text-xs text-alert"}>
        {ok
          ? "A site path (starting with /) or an https:// link."
          : "Use a site path starting with / or a full https:// link."}
      </p>
    </div>
  );
}

export function AddButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Plus className="size-3.5" aria-hidden /> {label}
    </button>
  );
}

/** Move up / move down / remove controls for an ordered list item. */
export function ItemControls({
  index,
  count,
  itemLabel,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  itemLabel: string;
  onMove?: (from: number, to: number) => void;
  onRemove: () => void;
}) {
  const btn =
    "inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div className="flex items-center gap-1">
      {onMove && (
        <>
          <button
            type="button"
            className={btn}
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
            aria-label={`Move ${itemLabel} up`}
            title="Move up"
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className={btn}
            disabled={index === count - 1}
            onClick={() => onMove(index, index + 1)}
            aria-label={`Move ${itemLabel} down`}
            title="Move down"
          >
            <ArrowDown className="size-4" aria-hidden />
          </button>
        </>
      )}
      <button
        type="button"
        className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-alert/10 hover:text-alert"
        onClick={onRemove}
        aria-label={`Remove ${itemLabel}`}
        title="Remove"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** Immutable array move. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}
