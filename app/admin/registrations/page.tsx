import type { Metadata } from "next";
import Link from "next/link";
import { Eye } from "lucide-react";
import { PaymentBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { getRegistrationsAdmin, getAllEventsAdmin } from "@/lib/data/admin";
import { formatEventDate } from "@/lib/utils";
import { requireScope } from "@/lib/auth";
import { teamLabel } from "@/lib/team-label";
import { groupRegistrations } from "@/lib/registration-groups";

export const metadata: Metadata = { title: "Admin · Registrations" };

export default async function AdminRegistrationsPage({
  searchParams,
}: PageProps<"/admin/registrations">) {
  await requireScope("events");
  const sp = await searchParams;
  const filters = {
    event: typeof sp.event === "string" ? sp.event : undefined,
  };

  const [rows, events] = await Promise.all([
    getRegistrationsAdmin(filters),
    getAllEventsAdmin(),
  ]);
  const { teams, singles } = groupRegistrations(rows);

  const selectCls =
    "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Registrations
        </h1>
        <p className="mt-1 text-sm text-muted">
          {teams.length} team and {singles.length} single registration{singles.length === 1 ? "" : "s"} (confirmed:
          free events, or payment verified). Payments waiting for review are in{" "}
          <Link href="/admin/payments" className="font-medium text-brand hover:underline">
            Payments
          </Link>
          .
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Event
          <select name="event" defaultValue={filters.event ?? ""} className={selectCls}>
            <option value="">All events</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-contrast"
        >
          Apply
        </button>
        <Link
          href="/admin/registrations"
          className="rounded-lg border border-border px-4 py-2 text-sm text-muted hover:text-foreground"
        >
          Reset
        </Link>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No registrations match" description="Adjust the filters above." />
      ) : (
        <>
          <section aria-labelledby="team-registrations" className="space-y-3">
            <h2 id="team-registrations" className="font-display text-lg font-semibold text-foreground">
              Team registrations ({teams.length})
            </h2>
            {teams.length === 0 ? (
              <p className="text-sm text-muted">No confirmed team registrations.</p>
            ) : (
              <ul className="space-y-3">
                {teams.map((t) => (
                  <li key={t.teamId} className="rounded-2xl border border-border bg-surface">
                    <details>
                      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 hover:bg-surface-2/40">
                        <div className="min-w-0">
                          <p className="font-mono text-xs text-brand">{t.code ?? "Team"}</p>
                          <p className="truncate font-medium text-foreground">{teamLabel(t.name)}</p>
                          <p className="truncate text-xs text-muted">
                            {t.head.event.title} · {t.members.length} people · head {t.head.profile.full_name}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <PaymentBadge status={t.head.payment_status} />
                          <span className="text-xs text-muted">{formatEventDate(t.head.registered_at.slice(0, 10))}</span>
                        </div>
                      </summary>
                      <div className="border-t border-border px-4 py-3">
                        <ul className="divide-y divide-border text-sm">
                          {t.members.map((m) => (
                            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                              <span className="min-w-0">
                                <span className="font-mono text-xs text-brand">{m.profile.participant_id}</span>{" "}
                                <span className="text-foreground">{m.profile.full_name}</span>
                                {m.is_team_head && <span className="ml-2 text-xs text-muted">head</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-3 flex justify-end">
                          <Link
                            href={`/admin/payments/${t.head.id}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2"
                          >
                            <Eye className="size-3.5" aria-hidden /> Review
                          </Link>
                        </div>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="single-registrations" className="space-y-3">
            <h2 id="single-registrations" className="font-display text-lg font-semibold text-foreground">
              Single registrations ({singles.length})
            </h2>
            {singles.length === 0 ? (
              <p className="text-sm text-muted">No confirmed single registrations.</p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-border">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="border-b border-border bg-surface-2/50 text-left text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-4 py-3 font-medium">Participant</th>
                      <th className="px-4 py-3 font-medium">Event</th>
                      <th className="px-4 py-3 font-medium">Payment</th>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 text-right font-medium">Review</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {singles.map((r) => (
                      <tr key={r.id} className="bg-surface hover:bg-surface-2/40">
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs text-brand">{r.profile.participant_id}</p>
                          <p className="text-foreground">{r.profile.full_name}</p>
                        </td>
                        <td className="px-4 py-3 text-muted">{r.event.title}</td>
                        <td className="px-4 py-3">
                          <PaymentBadge status={r.payment_status} />
                        </td>
                        <td className="px-4 py-3 text-xs text-muted">{formatEventDate(r.registered_at.slice(0, 10))}</td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/admin/payments/${r.id}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2"
                          >
                            <Eye className="size-3.5" aria-hidden /> Review
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
