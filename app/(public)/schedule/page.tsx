import type { Metadata } from "next";
import Link from "next/link";
import { Clock, MapPin } from "lucide-react";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { getEvents } from "@/lib/data/events";
import { CategoryName } from "@/components/events/categories-context";
import { formatEventDate, formatTime } from "@/lib/utils";
import type { EventRow } from "@/types/database";

export const metadata: Metadata = {
  title: "Schedule",
  description: "The full Wissendurst'27 programme, day by day.",
};

export default async function SchedulePage() {
  const events = await getEvents();

  const byDate = new Map<string, EventRow[]>();
  for (const e of events) {
    const key = e.event_date ?? "TBA";
    byDate.set(key, [...(byDate.get(key) ?? []), e]);
  }
  const days = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="py-14 md:py-20">
      <Container>
        <SectionHeading
          eyebrow="Schedule"
          title="Three days, mapped out."
          description="Times are indicative and may shift slightly. Open any event to register."
        />

        {days.length === 0 ? (
          <div className="mt-12">
            <EmptyState
              title="Schedule coming soon"
              description="Events will appear here as they're announced."
            />
          </div>
        ) : (
          <div className="mt-12 space-y-12">
            {days.map(([date, list]) => (
              <section key={date}>
                <div className="sticky top-16 z-10 -mx-2 bg-background/80 px-2 py-2 backdrop-blur">
                  <h2 className="font-display text-2xl font-semibold text-foreground">
                    {date === "TBA" ? "To be announced" : formatEventDate(date)}
                  </h2>
                </div>
                <ul className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                  {list
                    .slice()
                    .sort((a, b) =>
                      (a.start_time ?? "").localeCompare(b.start_time ?? ""),
                    )
                    .map((e) => (
                      <li key={e.id}>
                        <Link
                          href={`/events/${e.slug}`}
                          className="flex flex-col gap-2 p-5 transition-colors hover:bg-surface-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex items-start gap-4">
                            <div className="min-w-24 font-mono text-sm text-brand">
                              {e.start_time ? formatTime(e.start_time) : "—"}
                            </div>
                            <div>
                              <p className="font-medium text-foreground">
                                {e.title}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="size-3.5" />
                                  {e.end_time ? `until ${formatTime(e.end_time)}` : "TBA"}
                                </span>
                                {e.venue && (
                                  <span className="inline-flex items-center gap-1">
                                    <MapPin className="size-3.5" /> {e.venue}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <Badge tone="brand">
                            <CategoryName slug={e.category} />
                          </Badge>
                        </Link>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Container>
    </div>
  );
}
