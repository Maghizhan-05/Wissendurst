import type { Metadata } from "next";
import Link from "next/link";
import { Eye } from "lucide-react";
import { PaymentBadge, RegistrationBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { getRegistrationsAdmin, getAllEventsAdmin } from "@/lib/data/admin";
import {
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  REGISTRATION_STATUSES,
  REGISTRATION_STATUS_LABELS,
} from "@/lib/constants";
import { formatEventDate } from "@/lib/utils";
import { requireScope } from "@/lib/auth";
import { teamDisplay } from "@/lib/team-label";

export const metadata: Metadata = { title: "Admin · Registrations" };

export default async function AdminRegistrationsPage({
  searchParams,
}: PageProps<"/admin/registrations">) {
  await requireScope("events");
  const sp = await searchParams;
  const filters = {
    event: typeof sp.event === "string" ? sp.event : undefined,
    payment: typeof sp.payment === "string" ? sp.payment : undefined,
    registration: typeof sp.registration === "string" ? sp.registration : undefined,
    duplicatesOnly: sp.duplicates === "1",
  };

  const [rows, events] = await Promise.all([
    getRegistrationsAdmin(filters),
    getAllEventsAdmin(),
  ]);

  const selectCls =
    "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Registrations
        </h1>
        <p className="mt-1 text-sm text-muted">{rows.length} shown</p>
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
        <label className="flex flex-col gap-1 text-xs text-muted">
          Payment
          <select name="payment" defaultValue={filters.payment ?? ""} className={selectCls}>
            <option value="">Any</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PAYMENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Registration
          <select name="registration" defaultValue={filters.registration ?? ""} className={selectCls}>
            <option value="">Any</option>
            {REGISTRATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {REGISTRATION_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="duplicates"
            value="1"
            defaultChecked={filters.duplicatesOnly}
            className="size-4 accent-[var(--brand)]"
          />
          Duplicates only
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
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-border bg-surface-2/50 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Participant</th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Payment</th>
                <th className="px-4 py-3 font-medium">Transaction</th>
                <th className="px-4 py-3 font-medium">Registration</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 text-right font-medium">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={
                    r.payment_status === "duplicate"
                      ? "bg-alert/5 hover:bg-alert/10"
                      : "bg-surface hover:bg-surface-2/40"
                  }
                >
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs text-brand">
                      {r.profile.participant_id}
                    </p>
                    <p className="text-foreground">{r.profile.full_name}</p>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {r.event.title}
                    {teamDisplay(r.team) && (
                      <span className="mt-0.5 block max-w-56 truncate text-xs">
                        Team: <span className="text-foreground">{teamDisplay(r.team)}</span>
                        {r.is_team_head ? " · head" : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <PaymentBadge status={r.payment_status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {r.transaction_id ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <RegistrationBadge status={r.registration_status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {formatEventDate(r.registered_at.slice(0, 10))}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/payments/${r.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2"
                    >
                      <Eye className="size-3.5" /> Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
