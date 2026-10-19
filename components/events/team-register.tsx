"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { UserPlus, X, Crown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import {
  lookupTeamMember,
  registerTeam,
  type ActionResult,
  type TeamMember,
} from "@/lib/actions/registration";
import { formatINR } from "@/lib/utils";

type Head = {
  id: string;
  participant_id: string;
  full_name: string;
  email: string;
  college: string | null;
};

export function TeamRegister({
  eventId,
  slug,
  fee,
  teamMin,
  teamMax,
  head,
}: {
  eventId: string;
  slug: string;
  fee: number;
  teamMin: number;
  teamMax: number;
  head: Head;
}) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [pid, setPid] = useState("");
  const [looking, startLookup] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const [state, formAction, submitting] = useActionState(
    async (_prev: ActionResult | null, formData: FormData) =>
      registerTeam(formData),
    null,
  );
  useEffect(() => {
    if (state && !state.ok) toast.error(state.error);
  }, [state]);

  const teamSize = members.length + 1; // + head
  const atMax = teamSize >= teamMax;
  const canSubmit = teamSize >= teamMin && teamSize <= teamMax;
  const total = fee; // single flat fee for the whole team

  function addMember() {
    const value = pid.trim();
    if (!value) return;
    if (atMax) {
      toast.error(`Teams can have at most ${teamMax} members.`);
      return;
    }
    if (
      value.toLowerCase() === head.participant_id.toLowerCase()
    ) {
      toast.error("You're already the team head.");
      return;
    }
    if (members.some((m) => m.participant_id.toLowerCase() === value.toLowerCase())) {
      toast.error("That teammate is already added.");
      return;
    }
    startLookup(async () => {
      const res = await lookupTeamMember(value, eventId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.member.id === head.id || members.some((m) => m.id === res.member.id)) {
        toast.error("That teammate is already on the team.");
        return;
      }
      setMembers((prev) => [...prev, res.member]);
      setPid("");
      inputRef.current?.focus();
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold text-foreground">
          Register your team
        </h3>
        <span className="text-sm text-muted">
          {teamSize} / {teamMax}
          {teamMin > 1 ? ` · min ${teamMin}` : ""}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">
        Add teammates by their participant ID (W27/E/…), or register on your own.
        You pay one flat team fee; everyone is confirmed once your payment is
        verified.
      </p>

      {/* Head */}
      <div className="mt-4 space-y-2">
        <MemberRow
          title={`${head.full_name} (you)`}
          subtitle={`${head.participant_id} · ${head.email}`}
          head
        />
        {members.map((m) => (
          <MemberRow
            key={m.id}
            title={m.full_name}
            subtitle={`${m.participant_id} · ${m.email}${m.college ? ` · ${m.college}` : ""}`}
            onRemove={() => setMembers((prev) => prev.filter((x) => x.id !== m.id))}
          />
        ))}
      </div>

      {/* Add teammate */}
      <div className="mt-4 flex gap-2">
        <Input
          ref={inputRef}
          value={pid}
          onChange={(e) => setPid(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addMember();
            }
          }}
          placeholder="Teammate ID — W27/E/0007"
          className="font-mono"
          disabled={atMax || looking}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={addMember}
          loading={looking}
          disabled={atMax}
        >
          <UserPlus className="size-4" /> Add
        </Button>
      </div>

      {/* Submit */}
      <form action={formAction} className="mt-5 border-t border-border pt-5">
        <input type="hidden" name="event_id" value={eventId} />
        <input type="hidden" name="slug" value={slug} />
        <input
          type="hidden"
          name="member_ids"
          value={JSON.stringify(members.map((m) => m.id))}
        />
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted">Total to pay</p>
            <p className="font-display text-2xl font-semibold text-foreground">
              {total === 0 ? "Free" : formatINR(total)}
            </p>
            <p className="text-xs text-muted">
              {fee === 0 ? "Free event" : "Flat fee for the whole team"}
            </p>
          </div>
          <Button type="submit" size="lg" loading={submitting} disabled={!canSubmit} withArrow>
            Register team
          </Button>
        </div>
        {!canSubmit && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
            {looking && <Loader2 className="size-3.5 animate-spin" />}
            {teamSize < teamMin
              ? `Add ${teamMin - teamSize} more teammate${teamMin - teamSize === 1 ? "" : "s"} to reach the minimum of ${teamMin}.`
              : `Teams can have at most ${teamMax} members.`}
          </p>
        )}
      </form>
    </div>
  );
}

function MemberRow({
  title,
  subtitle,
  head,
  onRemove,
}: {
  title: string;
  subtitle: string;
  head?: boolean;
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2/40 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/12 text-brand">
          {head ? <Crown className="size-4" /> : <UserPlus className="size-4" />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          <p className="truncate text-xs text-muted">{subtitle}</p>
        </div>
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-alert"
          aria-label="Remove teammate"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
