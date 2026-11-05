import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EventFiltersEditor } from "@/components/admin/event-filters-editor";
import { getEventFilterConfig } from "@/lib/data/event-filters";
import { requireScope } from "@/lib/auth";

export const metadata: Metadata = { title: "Admin · Event filters" };

export default async function AdminEventFiltersPage() {
  await requireScope("events");
  const config = await getEventFilterConfig();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/admin/events"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to events
      </Link>
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">Event filters</h1>
        <p className="mt-1 text-sm text-muted">
          Choose the tabs shown above the public events list. Each tab shows one or more categories; a category can
          appear in several tabs. Event category badges don&rsquo;t change.
        </p>
      </div>
      <EventFiltersEditor initial={config} />
    </div>
  );
}
