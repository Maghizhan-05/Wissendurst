import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { EventsExplorer } from "@/components/events/events-explorer";
import {
  getTopLevelEvents,
  getSubEventCounts,
  getMyOfferPrices,
  soloDiscounts,
} from "@/lib/data/events";
import { getMyRegisteredEventIds } from "@/lib/data/registrations";
import { getEventFilterConfig } from "@/lib/data/event-filters";

export const metadata: Metadata = {
  title: "Events",
  description:
    "Browse every Wissendurst'27 event — workshops, debates, paper and poster presentations, and competitions.",
};

export default async function EventsPage({
  searchParams,
}: PageProps<"/events">) {
  const params = await searchParams;
  const category =
    typeof params.category === "string" ? params.category : undefined;

  const [events, subEventCounts, registeredIds, filterConfig] = await Promise.all([
    getTopLevelEvents(),
    getSubEventCounts(),
    getMyRegisteredEventIds(),
    getEventFilterConfig(),
  ]);
  const discounts = soloDiscounts(await getMyOfferPrices(events.map((e) => e.id)));

  return (
    <div className="py-14 md:py-20">
      <Container>
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand">
            The Programme
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold text-foreground sm:text-5xl">
            All events
          </h1>
          <p className="mt-4 text-lg text-muted">
            {events.length} event{events.length === 1 ? "" : "s"} across three
            days. Filter by track, search, and open any event to register.
          </p>
        </div>

        <div className="mt-12">
          <EventsExplorer
            events={events}
            subEventCounts={subEventCounts}
            discounts={discounts}
            registeredIds={[...registeredIds]}
            initialCategory={category}
            filterConfig={filterConfig}
          />
        </div>
      </Container>
    </div>
  );
}
