import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { Reveal } from "@/components/motion/reveal";
import { ButtonLink } from "@/components/ui/button";
import { EventCard } from "@/components/events/event-card";
import type { EventRow } from "@/types/database";
import { safeHrefOr } from "@/components/content/safe-link";
import type { LandingContent } from "@/lib/content/landing";

export function Featured({
  events,
  registeredIds,
  featured,
}: {
  events: EventRow[];
  registeredIds: Set<string>;
  featured: LandingContent["featured"];
}) {
  if (!featured.visible || events.length === 0) return null;
  return (
    <section className="py-20 md:py-28">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <Reveal>
            <SectionHeading
              index={featured.index}
              eyebrow={featured.eyebrow}
              title={featured.title}
            />
          </Reveal>
          {featured.ctaLabel && (
            <Reveal delay={0.1}>
              <ButtonLink href={safeHrefOr(featured.ctaHref, "/events")} variant="outline" withArrow>
                {featured.ctaLabel}
              </ButtonLink>
            </Reveal>
          )}
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {events.map((event, i) => (
            <Reveal key={event.id} delay={i * 0.06}>
              <EventCard event={event} registered={registeredIds.has(event.id)} />
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
