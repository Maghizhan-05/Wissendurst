"use client";

import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { AlertTriangle, Lock, Pencil, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AddTeammate,
  MemberRow,
  TeamNameField,
  priceFor,
  teamNameError,
  type TeamSizePriceView,
} from "@/components/events/team-builder";
import { editTeamRoster, type ActionResult, type TeamMember } from "@/lib/actions/registration";
import { teamLabel } from "@/lib/team-label";
import { cn, formatINR } from "@/lib/utils";

export type PanelMember = {
  id: string;
  participant_id: string;
  full_name: string;
  email: string;
  college: string | null;
  is_head: boolean;
};

/* The pay panel is disabled while the head edits the team. */
const EditingContext = createContext<{ editing: boolean; setEditing: (v: boolean) => void }>({
  editing: false,
  setEditing: () => {},
});

export function TeamEditScope({ children }: { children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  return <EditingContext.Provider value={{ editing, setEditing }}>{children}</EditingContext.Provider>;
}

export function PayPanelGuard({ children }: { children: ReactNode }) {
  const { editing } = useContext(EditingContext);
  return (
    <div className={cn("transition-opacity", editing && "pointer-events-none opacity-50")} inert={editing || undefined}>
      {children}
      {editing && (
        <p className="mt-3 text-xs text-muted">Finish editing your team to pay — the QR updates to the new amount.</p>
      )}
    </div>
  );
}

export function TeamPanel({
  registrationId,
  eventId,
  teamName,
  members,
  editable,
  locked,
  teamMin,
  teamMax,
  prices,
  currentAmount,
}: {
  registrationId: string;
  eventId: string;
  teamName: string | null;
  members: PanelMember[];
  /** Head, unpaid, no payment evidence, live hold (the RPC re-checks). */
  editable: boolean;
  /** Head after payment evidence: show why it can't change. */
  locked: boolean;
  teamMin: number;
  teamMax: number;
  prices: TeamSizePriceView[];
  currentAmount: number;
}) {
  const { editing, setEditing } = useContext(EditingContext);
  const head = members.find((m) => m.is_head) ?? members[0];
  const others = members.filter((m) => m !== head);

  const [name, setName] = useState(teamName ?? "");
  const [draft, setDraft] = useState<TeamMember[]>([]);
  const [nameTouched, setNameTouched] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  const [state, formAction, saving] = useActionState(
    async (_prev: ActionResult | null, formData: FormData) => editTeamRoster(formData),
    null,
  );
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      dialogRef.current?.close();
      setEditing(false);
      toast.success("Team saved.");
    } else {
      dialogRef.current?.close();
      toast.error(state.error);
    }
  }, [state, setEditing]);

  function startEditing() {
    setName(teamName ?? "");
    setDraft(
      others.map((m) => ({
        id: m.id,
        participant_id: m.participant_id,
        full_name: m.full_name,
        email: m.email,
        phone: null,
        college: m.college,
      })),
    );
    setNameTouched(false);
    setEditing(true);
  }

  const originalIds = new Set(others.map((m) => m.id));
  const draftIds = new Set(draft.map((m) => m.id));
  const removed = others.filter((m) => !draftIds.has(m.id));
  const added = draft.filter((m) => !originalIds.has(m.id));
  const size = draft.length + 1;
  const oldSize = others.length + 1;
  const needsName = size >= 2;
  const nameError = needsName ? teamNameError(name) : null;
  const newPrice = priceFor(prices, size);
  const nameChanged = (needsName ? name.trim() : "") !== (teamName ?? "");
  const changed = removed.length > 0 || added.length > 0 || nameChanged;
  const sizeOk = size >= teamMin && size <= teamMax;
  const canReview = changed && sizeOk && !nameError && newPrice !== null;

  if (!head) return null;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5" aria-labelledby="your-team-heading">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p id="your-team-heading" className="text-xs font-medium uppercase tracking-wider text-muted">
            Your team
          </p>
          {!editing && (
            <p className="mt-1 break-words font-display text-lg font-semibold text-foreground">
              {members.length > 1 ? teamLabel(teamName) : "Just you (team of one)"}
            </p>
          )}
        </div>
        {!editing && editable && (
          <Button variant="secondary" size="sm" onClick={startEditing}>
            <Pencil className="size-4" aria-hidden /> Edit team
          </Button>
        )}
        {!editing && locked && (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted">
            <Lock className="size-3.5" aria-hidden /> Locked
          </span>
        )}
      </div>

      {editing && needsName && (
        <div className="mt-2">
          <TeamNameField
            id="edit-team-name"
            value={name}
            onChange={(v) => {
              setName(v);
              setNameTouched(true);
            }}
            showError={nameTouched}
            hint="1–60 characters."
          />
        </div>
      )}

      <div className="mt-4 space-y-2">
        <MemberRow title={`${head.full_name} (you)`} subtitle={head.participant_id} head />
        {!editing &&
          others.map((m) => <MemberRow key={m.id} title={m.full_name} subtitle={m.participant_id} />)}
        {editing &&
          draft.map((m) => (
            <MemberRow
              key={m.id}
              title={m.full_name}
              subtitle={m.participant_id}
              flag={originalIds.has(m.id) ? undefined : "New"}
              onRemove={() => setDraft((d) => d.filter((x) => x.id !== m.id))}
            />
          ))}
      </div>

      {editing && (
        <>
          {removed.length > 0 && (
            <p className="mt-2 text-xs text-muted">
              Removed: {removed.map((m) => m.full_name).join(", ")} — their registration
              {removed.length === 1 ? " is" : "s are"} deleted and they can join another team.
            </p>
          )}
          <div className="mt-3">
            <AddTeammate
              eventId={eventId}
              headId={head.id}
              headParticipantId={head.participant_id}
              headRegistrationId={registrationId}
              members={draft}
              full={size >= teamMax}
              teamMax={teamMax}
              onAdd={(m) => setDraft((d) => [...d, m])}
            />
          </div>
          <p className={cn("mt-1 text-xs", sizeOk ? "text-muted" : "text-alert")}>
            {size} / {teamMax} · this event allows {teamMin === teamMax ? teamMin : `${teamMin}–${teamMax}`}{" "}
            {teamMax === 1 ? "person" : "people"}.
          </p>
          <div className="mt-4 rounded-xl border border-brand/40 bg-brand/8 p-3">
            {newPrice ? (
              <>
                <p className="text-sm text-foreground">
                  New total for {size === 1 ? "one person" : `a team of ${size}`}:{" "}
                  <span className="font-display text-lg font-semibold">
                    {newPrice.amount === 0 ? "Free" : formatINR(newPrice.amount)}
                  </span>
                  {newPrice.amount !== currentAmount && (
                    <span className="ml-2 text-sm text-muted line-through">{formatINR(currentAmount)}</span>
                  )}
                </p>
                <p className="text-xs text-muted">
                  {newPrice.amount !== currentAmount
                    ? `Was ${formatINR(currentAmount)} for ${oldSize === 1 ? "one person" : `a team of ${oldSize}`}. `
                    : ""}
                  You haven&rsquo;t paid yet, so nothing is charged until you pay.
                </p>
              </>
            ) : (
              <p className="text-sm text-alert">No price is set for a team of {size}.</p>
            )}
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              disabled={!canReview}
              onClick={() => {
                setNameTouched(true);
                if (!canReview) return;
                dialogRef.current?.showModal();
                keepRef.current?.focus();
              }}
            >
              Review changes
            </Button>
          </div>
        </>
      )}

      {!editing && locked && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-surface-2/50 p-3 text-sm text-muted">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            You&rsquo;ve submitted payment, so your team name and members can&rsquo;t change any more. Contact
            the organizers if something is wrong.
          </span>
        </p>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-6 text-foreground shadow-2xl backdrop:bg-black/60"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning"
            >
              <AlertTriangle className="size-4" />
            </span>
            <div className="min-w-0 space-y-2">
              <h2 id={titleId} className="font-display text-lg font-semibold text-foreground">
                Save these team changes?
              </h2>
              <div id={descId} className="space-y-2 text-sm text-muted">
                <ul className="space-y-1">
                  {removed.length > 0 && (
                    <li className="flex gap-2">
                      <Trash2 className="mt-0.5 size-4 shrink-0 text-alert" aria-hidden />
                      <span>
                        Remove <span className="text-foreground">{joinNames(removed.map((m) => m.full_name))}</span> —
                        {removed.length === 1 ? " their registration" : " their registrations"} for this event{" "}
                        {removed.length === 1 ? "is" : "are"} deleted.
                      </span>
                    </li>
                  )}
                  {added.length > 0 && (
                    <li className="flex gap-2">
                      <Plus className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                      <span>
                        Add <span className="text-foreground">{joinNames(added.map((m) => m.full_name))}</span>.
                      </span>
                    </li>
                  )}
                  {size !== oldSize && (
                    <li className="flex gap-2">
                      <Users className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                      <span>
                        Team of {oldSize} → {size}.
                      </span>
                    </li>
                  )}
                  {nameChanged && needsName && (
                    <li className="flex gap-2">
                      <Pencil className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                      <span className="min-w-0 break-words">
                        Rename to <span className="text-foreground">{name.trim()}</span>.
                      </span>
                    </li>
                  )}
                </ul>
                {newPrice && newPrice.amount !== currentAmount && (
                  <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-foreground">
                    Amount to pay changes from <span className="font-semibold">{formatINR(currentAmount)}</span> to{" "}
                    <span className="font-semibold">{newPrice.amount === 0 ? "Free" : formatINR(newPrice.amount)}</span>.
                  </p>
                )}
                <p>Your seat hold stays the same. Once you submit payment, your team can&rsquo;t be changed.</p>
              </div>
            </div>
          </div>
          <form action={formAction} className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <input type="hidden" name="registration_id" value={registrationId} />
            <input type="hidden" name="member_ids" value={JSON.stringify(draft.map((m) => m.id))} />
            <input type="hidden" name="team_name" value={needsName ? name.trim() : ""} />
            <Button ref={keepRef} type="button" variant="secondary" onClick={() => dialogRef.current?.close()} disabled={saving}>
              Keep editing
            </Button>
            <Button type="submit" loading={saving}>
              Save team{newPrice ? ` · ${newPrice.amount === 0 ? "Free" : formatINR(newPrice.amount)}` : ""}
            </Button>
          </form>
        </div>
      </dialog>
    </section>
  );
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
