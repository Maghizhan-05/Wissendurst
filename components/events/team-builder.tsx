"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Crown, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { lookupTeamMember, type TeamMember } from "@/lib/actions/registration";
import { cn, formatINR } from "@/lib/utils";

/** Shared pieces of team registration and pre-payment team editing (0030). */

export const TEAM_NAME_MAX = 60;

export type TeamSizePriceView = { size: number; list: number; discount: number; amount: number };

/** Mirrors teams_name_valid: trimmed, 1–60 characters, no control characters. */
export function teamNameError(name: string): string | null {
  const v = name.trim();
  if (!v) return "Give your team a name (1–60 characters).";
  if (v.length > TEAM_NAME_MAX) return `Team names can be at most ${TEAM_NAME_MAX} characters.`;
  if (/[\u0000-\u001f\u007f]/.test(v)) return "Team names can't contain line breaks or control characters.";
  return null;
}

export function TeamNameField({
  value,
  onChange,
  showError,
  hint = "Shown to organizers and on your registration. You can change it until you pay.",
  id = "team-name",
}: {
  value: string;
  onChange: (v: string) => void;
  showError: boolean;
  hint?: string;
  id?: string;
}) {
  const error = showError ? teamNameError(value) : null;
  return (
    <div>
      <Label htmlFor={id}>
        Team name<span className="ml-0.5 text-alert">*</span>
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={TEAM_NAME_MAX}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint`}
        className={cn(error && "border-alert focus-visible:outline-alert")}
      />
      <p id={`${id}-hint`} className={cn("mt-1 flex justify-between gap-3 text-xs", error ? "text-alert" : "text-muted")}>
        <span>{error ?? hint}</span>
        <span className="shrink-0 font-mono">
          {value.length}/{TEAM_NAME_MAX}
        </span>
      </p>
    </div>
  );
}

export function MemberRow({
  title,
  subtitle,
  head,
  onRemove,
  flag,
}: {
  title: string;
  subtitle: string;
  head?: boolean;
  onRemove?: () => void;
  flag?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-xl border bg-surface-2/40 px-3 py-2.5",
        flag ? "border-brand/50" : "border-border",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/12 text-brand">
          {head ? <Crown className="size-4" aria-hidden /> : <UserPlus className="size-4" aria-hidden />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {title}
            {flag && (
              <Badge tone="brand" className="ml-1.5 align-middle">
                {flag}
              </Badge>
            )}
          </p>
          <p className="truncate text-xs text-muted">{subtitle}</p>
        </div>
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${title}`}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-alert sm:size-9"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Participant-ID input that looks a teammate up and hands them back. */
export function AddTeammate({
  eventId,
  headId,
  headParticipantId,
  members,
  full,
  teamMax,
  onAdd,
  headRegistrationId,
}: {
  /** Editing an existing team (its own members aren't "already registered"). */
  headRegistrationId?: string;
  eventId: string;
  headId: string;
  headParticipantId: string;
  members: TeamMember[];
  full: boolean;
  teamMax: number;
  onAdd: (m: TeamMember) => void;
}) {
  const [pid, setPid] = useState("");
  const [looking, startLookup] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function add() {
    const value = pid.trim();
    if (!value) return;
    if (full) {
      toast.error(`Teams can have at most ${teamMax} members.`);
      return;
    }
    if (value.toLowerCase() === headParticipantId.toLowerCase()) {
      toast.error("You're already the team head.");
      return;
    }
    if (members.some((m) => m.participant_id.toLowerCase() === value.toLowerCase())) {
      toast.error("That teammate is already added.");
      return;
    }
    startLookup(async () => {
      const res = await lookupTeamMember(value, eventId, headRegistrationId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.member.id === headId || members.some((m) => m.id === res.member.id)) {
        toast.error("That teammate is already on the team.");
        return;
      }
      onAdd(res.member);
      setPid("");
      inputRef.current?.focus();
    });
  }

  return (
    <div className="flex gap-2">
      <Input
        ref={inputRef}
        value={pid}
        onChange={(e) => setPid(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        placeholder={full ? "Team is full" : "Teammate ID — W27/E/0007"}
        aria-label="Teammate participant ID"
        className="font-mono"
        disabled={full || looking}
      />
      <Button type="button" variant="secondary" onClick={add} loading={looking} disabled={full}>
        <UserPlus className="size-4" aria-hidden /> Add
      </Button>
    </div>
  );
}

/** Price of a team of `size` from the per-size list (null when unpriced). */
export function priceFor(prices: readonly TeamSizePriceView[], size: number) {
  return prices.find((p) => p.size === size) ?? null;
}

export function TotalToPay({ price, size }: { price: TeamSizePriceView | null; size: number }) {
  if (!price) {
    return <p className="text-sm text-alert">No price is set for a team of {size}.</p>;
  }
  return (
    <div>
      <p className="text-sm text-muted">Total to pay</p>
      <p className="font-display text-2xl font-semibold text-foreground">
        {price.discount > 0 && (
          <span className="mr-2 align-middle font-mono text-sm font-normal text-muted line-through">
            {formatINR(price.list)}
          </span>
        )}
        {price.amount === 0 ? "Free" : formatINR(price.amount)}
      </p>
      {price.discount > 0 && (
        <p className="text-xs font-medium text-success">Event offer: you save {formatINR(price.discount)}</p>
      )}
      <p className="text-xs text-muted">{size === 1 ? "Price for one person" : `Price for a team of ${size}`}</p>
    </div>
  );
}
