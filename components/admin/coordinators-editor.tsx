"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronUp, Mail, Phone, Plus, Trash2, UserRound } from "lucide-react";
import { Input, Label } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import {
  MAX_COORDINATORS,
  MAX_COORDINATOR_EMAIL,
  MAX_COORDINATOR_NAME,
  MAX_COORDINATOR_ROLE,
  validateCoordinators,
  type CoordinatorDraft,
} from "@/lib/events/coordinators";

const EMPTY: CoordinatorDraft = { name: "", role: "", phone: "", email: "" };

/**
 * Public coordinator boxes (0035 / D-023). Rows are submitted as JSON in the
 * hidden `coordinators` field; the server and the database validate again.
 * Order here is the order on the event page.
 */
export function CoordinatorsEditor({ initial }: { initial: CoordinatorDraft[] }) {
  const uid = useId();
  const [rows, setRows] = useState<(CoordinatorDraft & { key: number; touched: boolean })[]>(() =>
    initial.map((r, i) => ({ ...r, key: i, touched: true })),
  );
  const [nextKey, setNextKey] = useState(initial.length);
  const result = validateCoordinators(rows);
  const rowErrors = result.ok ? [] : result.rowErrors;
  const full = rows.length >= MAX_COORDINATORS;

  const update = (i: number, patch: Partial<CoordinatorDraft & { touched: boolean }>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows((prev) => {
      const next = [...prev];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });
  const add = () => {
    if (full) return;
    setRows((prev) => [...prev, { ...EMPTY, key: nextKey, touched: false }]);
    setNextKey((k) => k + 1);
  };

  return (
    <section aria-labelledby={`${uid}-h`} className="space-y-4">
      <input
        type="hidden"
        name="coordinators"
        value={JSON.stringify(rows.map(({ name, role, phone, email }) => ({ name, role, phone, email })))}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`${uid}-h`} className="font-display text-lg font-semibold text-foreground">
            Event coordinators
          </h2>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Optional. Shown on the public event page so participants can reach the organisers.
            Each coordinator needs a name and a phone number, an email, or both. Leave the list
            empty to hide the section.
          </p>
        </div>
        <span className="rounded-full border border-border px-2.5 py-0.5 font-mono text-xs text-muted" aria-live="polite">
          {rows.length} of {MAX_COORDINATORS}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-brand/12 text-brand">
            <UserRound className="size-5" aria-hidden />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">No coordinators yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted">
            The Coordinators card stays hidden on the event page until you add one.
          </p>
          <AddButton onClick={add} disabled={false} className="mt-4" />
        </div>
      ) : (
        <ol className="overflow-hidden rounded-2xl border border-border">
          {rows.map((r, i) => {
            const e = r.touched ? (rowErrors[i] ?? {}) : {};
            const contactBad = Boolean(e.contact);
            const id = `${uid}-${r.key}`;
            const hasError = Object.keys(e).length > 0;
            return (
              <li
                key={r.key}
                aria-labelledby={`${id}-t`}
                className={cn(
                  "border-border bg-surface-2/40 p-4 sm:p-5 [&:not(:first-child)]:border-t",
                  hasError && "bg-alert/5 shadow-[inset_3px_0_0_var(--alert)]",
                )}
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand/12 font-mono text-xs text-brand">
                      {i + 1}
                    </span>
                    <span id={`${id}-t`} className="truncate text-sm font-medium text-foreground">
                      {r.name.trim() || "New coordinator"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton label={`Move coordinator ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ChevronUp className="size-4" />
                    </IconButton>
                    <IconButton
                      label={`Move coordinator ${i + 1} down`}
                      disabled={i === rows.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ChevronDown className="size-4" />
                    </IconButton>
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-alert hover:bg-alert/10"
                      aria-label={`Remove coordinator ${i + 1}${r.name.trim() ? `, ${r.name.trim()}` : ""}`}
                    >
                      <Trash2 className="size-3.5" aria-hidden /> Remove
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <TextField
                    id={`${id}-name`}
                    label="Name"
                    required
                    value={r.name}
                    maxLength={MAX_COORDINATOR_NAME}
                    placeholder="Full name"
                    error={e.name}
                    onChange={(v) => update(i, { name: v })}
                    onBlur={() => update(i, { touched: true })}
                  />
                  <TextField
                    id={`${id}-role`}
                    label="Role"
                    optional
                    value={r.role}
                    maxLength={MAX_COORDINATOR_ROLE}
                    placeholder="e.g. Faculty coordinator"
                    error={e.role}
                    onChange={(v) => update(i, { role: v })}
                    onBlur={() => update(i, { touched: true })}
                  />
                  <fieldset
                    className={cn(
                      "grid gap-4 rounded-xl border border-border bg-background/40 p-3 md:col-span-2 md:grid-cols-2",
                      contactBad && "border-alert/60",
                    )}
                  >
                    <legend className="px-1 text-xs text-muted">How participants reach them — at least one</legend>
                    <TextField
                      id={`${id}-phone`}
                      label="Phone"
                      icon={<Phone className="size-4" aria-hidden />}
                      type="tel"
                      value={r.phone}
                      maxLength={20}
                      placeholder="+91 98765 43210"
                      error={e.phone}
                      invalid={contactBad}
                      onChange={(v) => update(i, { phone: v })}
                      onBlur={() => update(i, { touched: true })}
                    />
                    <TextField
                      id={`${id}-email`}
                      label="Email"
                      icon={<Mail className="size-4" aria-hidden />}
                      type="email"
                      value={r.email}
                      maxLength={MAX_COORDINATOR_EMAIL}
                      placeholder="name@college.edu"
                      error={e.email}
                      invalid={contactBad}
                      onChange={(v) => update(i, { email: v })}
                      onBlur={() => update(i, { touched: true })}
                    />
                    {contactBad && (
                      <p role="alert" className="text-xs text-alert md:col-span-2">
                        {e.contact}
                      </p>
                    )}
                  </fieldset>
                </div>
              </li>
            );
          })}
          <li className="flex flex-col gap-2 border-t border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <AddButton onClick={add} disabled={full} />
            <span className="text-xs text-muted">
              {full
                ? `Limit reached — up to ${MAX_COORDINATORS} coordinators per event.`
                : "Name required · phone or email required · role optional"}
            </span>
          </li>
        </ol>
      )}
    </section>
  );
}

function AddButton({ onClick, disabled, className }: { onClick: () => void; disabled: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-full border border-dashed border-brand/55 px-4 text-sm font-medium text-brand hover:bg-brand/10 disabled:cursor-not-allowed disabled:border-border disabled:text-muted disabled:opacity-70",
        className,
      )}
    >
      <Plus className="size-4" aria-hidden /> Add coordinator
    </button>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function TextField({
  id,
  label,
  required,
  optional,
  icon,
  type = "text",
  value,
  maxLength,
  placeholder,
  error,
  invalid,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  required?: boolean;
  optional?: boolean;
  icon?: React.ReactNode;
  type?: string;
  value: string;
  maxLength: number;
  placeholder: string;
  error?: string;
  invalid?: boolean;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  const bad = Boolean(error) || Boolean(invalid);
  return (
    <div>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="ml-0.5 text-alert" aria-hidden>
            *
          </span>
        )}
        {optional && <span className="ml-1.5 text-xs font-normal text-muted">Optional</span>}
      </Label>
      <div className="relative">
        {icon && <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">{icon}</span>}
        <Input
          id={id}
          type={type}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          required={required}
          aria-invalid={bad || undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          className={cn(icon && "pl-10", bad && "border-alert")}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      </div>
      {error && (
        <p id={`${id}-err`} className="mt-1.5 text-xs text-alert">
          {error}
        </p>
      )}
    </div>
  );
}
