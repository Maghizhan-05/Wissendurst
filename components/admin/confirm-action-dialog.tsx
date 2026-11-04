"use client";

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AdminActionState } from "@/lib/actions/admin";

type Tone = "danger" | "warning" | "neutral";

interface ConfirmActionDialogProps {
  /** Server action run only after the admin confirms. */
  action: (
    prev: AdminActionState,
    formData: FormData,
  ) => Promise<AdminActionState>;
  /** Hidden form fields sent with the action. */
  fields: Record<string, string>;
  /** Accessible name + tooltip of the icon trigger. */
  triggerLabel: string;
  triggerIcon: ReactNode;
  triggerClassName?: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: Tone;
}

/**
 * Icon trigger + modal confirmation for destructive admin actions. Uses the
 * native <dialog> (focus containment, Escape, inert background); initial focus
 * lands on Cancel so a stray Enter never confirms.
 */
export function ConfirmActionDialog({
  action,
  fields,
  triggerLabel,
  triggerIcon,
  triggerClassName,
  title,
  description,
  confirmLabel,
  tone = "danger",
}: ConfirmActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();
  const [state, formAction, pending] = useActionState(action, null);
  // Only show results produced after the dialog was (re)opened.
  const [stateAtOpen, setStateAtOpen] = useState<AdminActionState>(null);
  const fresh = state !== stateAtOpen ? state : null;

  const open = () => {
    setStateAtOpen(state);
    dialogRef.current?.showModal();
    cancelRef.current?.focus();
  };
  const close = () => dialogRef.current?.close();

  useEffect(() => {
    if (fresh?.ok) dialogRef.current?.close();
  }, [fresh]);

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        aria-label={triggerLabel}
        title={triggerLabel}
        className={cn(
          "rounded-md p-2 text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          triggerClassName,
        )}
      >
        {triggerIcon}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descId}
        onCancel={(e) => {
          if (pending) e.preventDefault(); // don't dismiss mid-request
        }}
        onClick={(e) => {
          // Backdrop click (the event target is the dialog element itself).
          if (e.target === dialogRef.current && !pending) close();
        }}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-0 text-left text-foreground shadow-2xl backdrop:bg-black/60"
      >
        <form action={formAction} className="space-y-4 p-6">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}

          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className={cn(
                "mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full",
                tone === "danger" && "bg-alert/10 text-alert",
                tone === "warning" && "bg-warning/10 text-warning",
                tone === "neutral" && "bg-brand/10 text-brand",
              )}
            >
              <AlertTriangle className="size-4" />
            </span>
            <div className="min-w-0 space-y-1.5">
              <h2
                id={titleId}
                className="font-display text-lg font-semibold text-foreground"
              >
                {title}
              </h2>
              <div id={descId} className="space-y-2 text-sm text-muted">
                {description}
              </div>
            </div>
          </div>

          {fresh && !fresh.ok && (
            <p
              role="alert"
              className="rounded-lg border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert"
            >
              {fresh.error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button
              ref={cancelRef}
              type="button"
              variant="secondary"
              size="sm"
              onClick={close}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={tone === "danger" ? "danger" : "primary"}
              size="sm"
              loading={pending}
            >
              {confirmLabel}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
