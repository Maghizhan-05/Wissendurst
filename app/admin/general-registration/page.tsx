import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { PaymentBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { GeneralRegistrationSettingsForm } from "@/components/admin/general-registration-settings-form";
import { GeneralRegistrationEventsForm } from "@/components/admin/general-registration-events-form";
import {
  getCoverageOptions,
  getGeneralRegistrationSettings,
  listGeneralRegistrations,
} from "@/lib/data/general-registration";
import { createClient } from "@/lib/supabase/server";
import { defaultUpiId } from "@/lib/payment";
import { requireScope } from "@/lib/auth";
import { formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · General Registration" };

const REVIEW = new Set(["under_review", "uploaded", "duplicate"]);

export default async function AdminGeneralRegistrationPage() {
  await requireScope("payments");
  const supabase = await createClient();
  const [settings, options, records, { data: upis }] = await Promise.all([
    getGeneralRegistrationSettings(),
    getCoverageOptions(),
    listGeneralRegistrations(),
    supabase.from("events").select("upi_id").not("upi_id", "is", null),
  ]);
  const eventUpiIds = Array.from(
    new Set([defaultUpiId(), ...((upis ?? []) as { upi_id: string }[]).map((u) => u.upi_id.trim())].filter(Boolean)),
  );
  const queue = records.filter((r) => REVIEW.has(r.status));
  const verified = records.filter((r) => r.status === "verified").length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">General Registration</h1>
        <p className="mt-1 text-sm text-muted">
          {settings.enabled ? "Open" : "Closed"} · {verified} verified · {queue.length} awaiting review
        </p>
      </div>

      <section aria-labelledby="gr-queue" className="space-y-3">
        <h2 id="gr-queue" className="font-display text-lg font-semibold text-foreground">Payments</h2>
        {records.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="size-8 text-success" />}
            title="No General Registration payments yet"
            description="Payments appear here once participants start General Registration."
          />
        ) : (
          <ul className="space-y-2">
            {records.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/admin/general-registration/${r.id}`}
                  className={`flex items-center justify-between gap-4 rounded-2xl border p-4 transition-colors ${
                    r.status === "duplicate"
                      ? "border-alert/30 bg-alert/5 hover:bg-alert/10"
                      : "border-border bg-surface hover:bg-surface-2/40"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-brand">{r.profile?.participant_id ?? "—"}</span>
                      {r.previous_participant_id && (
                        <span className="font-mono text-xs text-muted">(was {r.previous_participant_id})</span>
                      )}
                      <span className="truncate font-medium text-foreground">{r.profile?.full_name}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted">
                      {formatINR(r.amount)} · UTR {r.transaction_id ?? "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <PaymentBadge status={r.status} />
                    <ArrowRight className="size-4 text-muted" aria-hidden />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <GeneralRegistrationSettingsForm settings={settings} eventUpiIds={eventUpiIds} />
        <GeneralRegistrationEventsForm options={options} />
      </div>
    </div>
  );
}
