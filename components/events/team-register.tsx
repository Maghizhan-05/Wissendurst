"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { registerTeam, type ActionResult, type TeamMember } from "@/lib/actions/registration";
import {
  AddTeammate,
  MemberRow,
  TeamNameField,
  TotalToPay,
  priceFor,
  teamNameError,
  type TeamSizePriceView,
} from "@/components/events/team-builder";

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
  prices,
  teamMin,
  teamMax,
  head,
}: {
  eventId: string;
  slug: string;
  /** Price of every team size 1..teamMax for this head (offers applied). */
  prices: TeamSizePriceView[];
  teamMin: number;
  teamMax: number;
  head: Head;
}) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);

  const [state, formAction, submitting] = useActionState(
    async (_prev: ActionResult | null, formData: FormData) => registerTeam(formData),
    null,
  );
  useEffect(() => {
    if (state && !state.ok) toast.error(state.error);
  }, [state]);

  const teamSize = members.length + 1; // + head
  const needsName = teamSize >= 2;
  const nameError = needsName ? teamNameError(name) : null;
  const sizeOk = teamSize >= teamMin && teamSize <= teamMax;
  const price = priceFor(prices, teamSize);
  const canSubmit = sizeOk && !nameError && price !== null;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold text-foreground">Register your team</h3>
        <span className="shrink-0 text-sm text-muted">
          {teamSize} / {teamMax}
          {teamMin > 1 ? ` · min ${teamMin}` : ""}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">
        {teamMin > 1 ? "Name your team and add" : "Add"} teammates by their participant ID (W27/E/…)
        {teamMin > 1 ? "." : ", or register on your own."} You pay once for the whole team; everyone is
        confirmed once your payment is verified.
      </p>

      {needsName && (
        <div className="mt-4">
          <TeamNameField
            value={name}
            onChange={(v) => {
              setName(v);
              setNameTouched(true);
            }}
            showError={nameTouched}
          />
        </div>
      )}

      <div className="mt-4 space-y-2">
        <MemberRow title={`${head.full_name} (you)`} subtitle={`${head.participant_id} · ${head.email}`} head />
        {members.map((m) => (
          <MemberRow
            key={m.id}
            title={m.full_name}
            subtitle={`${m.participant_id} · ${m.email}${m.college ? ` · ${m.college}` : ""}`}
            onRemove={() => setMembers((prev) => prev.filter((x) => x.id !== m.id))}
          />
        ))}
      </div>

      <div className="mt-4">
        <AddTeammate
          eventId={eventId}
          headId={head.id}
          headParticipantId={head.participant_id}
          members={members}
          full={teamSize >= teamMax}
          teamMax={teamMax}
          onAdd={(m) => setMembers((prev) => [...prev, m])}
        />
      </div>

      <form
        action={formAction}
        onSubmit={() => setNameTouched(true)}
        className="mt-5 border-t border-border pt-5"
      >
        <input type="hidden" name="event_id" value={eventId} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="member_ids" value={JSON.stringify(members.map((m) => m.id))} />
        <input type="hidden" name="team_name" value={needsName ? name.trim() : ""} />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <TotalToPay price={price} size={teamSize} />
          <Button type="submit" size="lg" loading={submitting} disabled={!canSubmit} withArrow>
            Register team
          </Button>
        </div>
        {!canSubmit && (
          <p className="mt-3 text-xs text-muted">
            {teamSize < teamMin
              ? `Add ${teamMin - teamSize} more teammate${teamMin - teamSize === 1 ? "" : "s"} to reach the minimum of ${teamMin}${needsName && nameError ? ", and name your team" : ""}.`
              : teamSize > teamMax
                ? `Teams can have at most ${teamMax} members.`
                : nameError
                  ? "Name your team to register."
                  : null}
          </p>
        )}
      </form>
    </div>
  );
}
