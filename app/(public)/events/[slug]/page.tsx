import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  CalendarDays,
  Clock,
  MapPin,
  IndianRupee,
  Users,
  GraduationCap,
  ListChecks,
  Layers,
  ChevronRight,
} from "lucide-react";
import type { EventRow } from "@/types/database";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { EventThumb } from "@/components/events/category-visual";
import { EventCard } from "@/components/events/event-card";
import { RegisterCta } from "@/components/events/register-cta";
import {
  getEventBySlug,
  getSubEvents,
  getSubEventCounts,
  getEventAncestors,
  getEventRegistrationCounts,
} from "@/lib/data/events";
import {
  getMyRegistrationForEvent,
  getMyRegisteredEventIds,
} from "@/lib/data/registrations";
import { getProfile } from "@/lib/auth";
import { EVENT_CATEGORY_LABELS } from "@/lib/constants";
import { formatEventDate, formatINR, formatTime } from "@/lib/utils";
import { EventBackground } from "@/components/three/event-background";

export async function generateMetadata({
  params,
}: PageProps<"/events/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return { title: "Event not found" };
  return {
    title: event.title,
    description: event.short_description,
    openGraph: {
      title: event.title,
      description: event.short_description,
      images: event.hero_image ? [event.hero_image] : undefined,
    },
  };
}

export default async function EventPage({
  params,
}: PageProps<"/events/[slug]">) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  const subEvents = await getSubEvents(event.id);

  // A broader event with exactly one sub-event behaves as that sub-event.
  if (subEvents.length === 1) {
    redirect(`/events/${subEvents[0].slug}`);
  }

  // A broader event with several sub-events renders as a hub.
  if (subEvents.length > 1) {
    const [registeredIds, counts, ancestors] = await Promise.all([
      getMyRegisteredEventIds(),
      getSubEventCounts(),
      getEventAncestors(event),
    ]);
    return (
      <article className="py-10 md:py-14">
        <EventBackground category={event.category} slug={event.slug} />
        <Container>
          <Breadcrumb ancestors={ancestors} />
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">
                {EVENT_CATEGORY_LABELS[event.category]}
              </Badge>
              <Badge tone="neutral">
                <Layers className="size-3" /> {subEvents.length} events
              </Badge>
              {!event.is_live && <Badge tone="warning">Coming soon</Badge>}
            </div>
            <h1 className="mt-4 font-display text-4xl font-semibold leading-tight text-foreground sm:text-5xl">
              {event.title}
            </h1>
            <p className="mt-4 text-lg text-muted">{event.short_description}</p>
            {event.description && (
              <div className="mt-6 space-y-4 whitespace-pre-line text-base leading-relaxed text-muted">
                {event.description}
              </div>
            )}
          </div>

          <div className="mt-10 flex items-center gap-3">
            <h2 className="font-display text-2xl font-semibold text-foreground">
              Choose an event
            </h2>
            <span className="text-sm text-muted">
              {subEvents.length} to pick from
            </span>
          </div>

          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {subEvents.map((sub) => (
              <EventCard
                key={sub.id}
                event={sub}
                registered={registeredIds.has(sub.id)}
                subEventCount={counts[sub.id] ?? 0}
              />
            ))}
          </div>
        </Container>
      </article>
    );
  }

  // Leaf: a standalone event or a single sub-event — the register page.
  const [profile, existing, counts, ancestors] = await Promise.all([
    getProfile(),
    getMyRegistrationForEvent(event.id),
    getEventRegistrationCounts(),
    getEventAncestors(event),
  ]);

  const taken = counts[event.id] ?? 0;
  const isFull =
    event.max_participants != null && taken >= event.max_participants;
  const spotsLeft =
    event.max_participants != null
      ? Math.max(event.max_participants - taken, 0)
      : null;

  const details = [
    {
      icon: CalendarDays,
      label: "Date",
      value: formatEventDate(event.event_date),
    },
    {
      icon: Clock,
      label: "Time",
      value:
        event.start_time && event.end_time
          ? `${formatTime(event.start_time)} – ${formatTime(event.end_time)}`
          : "TBA",
    },
    { icon: MapPin, label: "Venue", value: event.venue ?? "TBA" },
    {
      icon: IndianRupee,
      label: "Fee",
      value:
        event.registration_fee === 0
          ? "Free"
          : formatINR(event.registration_fee),
    },
    {
      icon: Users,
      label: "Capacity",
      value:
        event.max_participants != null
          ? `${taken} / ${event.max_participants} filled`
          : "Open",
    },
    {
      icon: GraduationCap,
      label: "Eligibility",
      value: event.eligibility ?? "Open to all students",
    },
  ];

  return (
    <article className="py-10 md:py-14">
      <EventBackground category={event.category} slug={event.slug} />
      <Container>
        <Breadcrumb ancestors={ancestors} />
        {/* Hero */}
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="relative order-2 aspect-[16/11] overflow-hidden rounded-3xl border border-border lg:order-1">
            <EventThumb
              src={event.hero_image ?? event.thumbnail_image}
              alt={event.title}
              category={event.category}
              sizes="(max-width: 1024px) 100vw, 50vw"
              priority
            />
          </div>

          <div className="order-1 flex flex-col justify-center lg:order-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">
                {EVENT_CATEGORY_LABELS[event.category]}
              </Badge>
              {!event.is_live && <Badge tone="warning">Coming soon</Badge>}
              {event.is_live && !event.registration_open && (
                <Badge tone="alert">Closed</Badge>
              )}
              {spotsLeft != null && spotsLeft <= 5 && spotsLeft > 0 && (
                <Badge tone="warning">{spotsLeft} spots left</Badge>
              )}
            </div>
            <h1 className="mt-4 font-display text-4xl font-semibold leading-tight text-foreground sm:text-5xl">
              {event.title}
            </h1>
            <p className="mt-4 text-lg text-muted">{event.short_description}</p>
            <div className="mt-8">
              <RegisterCta
                eventId={event.id}
                slug={event.slug}
                isLoggedIn={!!profile}
                isLive={event.is_live}
                registrationOpen={event.registration_open}
                isFull={isFull}
                fee={event.registration_fee}
                existing={existing}
                teamEnabled={event.team_enabled}
                teamMin={event.team_min}
                teamMax={event.team_max}
                head={
                  profile
                    ? {
                        id: profile.id,
                        participant_id: profile.participant_id ?? "",
                        full_name: profile.full_name,
                        email: profile.email,
                        college: profile.college,
                      }
                    : null
                }
              />
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="mt-16 grid gap-12 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-12">
            {event.description && (
              <section>
                <h2 className="font-display text-2xl font-semibold text-foreground">
                  Overview
                </h2>
                <div className="mt-4 space-y-4 whitespace-pre-line text-base leading-relaxed text-muted">
                  {event.description}
                </div>
              </section>
            )}

            {event.rules.length > 0 && (
              <section>
                <h2 className="flex items-center gap-2 font-display text-2xl font-semibold text-foreground">
                  <ListChecks className="size-5 text-brand" /> Rules
                </h2>
                <ul className="mt-5 space-y-3">
                  {event.rules.map((rule, i) => (
                    <li key={i} className="flex gap-3 text-muted">
                      <span className="mt-0.5 font-mono text-xs text-brand">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>{rule}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {/* Details rail */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-border bg-surface p-6">
              <h2 className="font-display text-lg font-semibold text-foreground">
                Event details
              </h2>
              <dl className="mt-5 space-y-4">
                {details.map((d) => (
                  <div key={d.label} className="flex items-start gap-3">
                    <d.icon className="mt-0.5 size-[18px] shrink-0 text-brand" />
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                        {d.label}
                      </dt>
                      <dd className="text-sm font-medium text-foreground">
                        {d.value}
                      </dd>
                    </div>
                  </div>
                ))}
              </dl>
            </div>
          </aside>
        </div>
      </Container>
    </article>
  );
}

/** Root → … → immediate-parent trail above the hero. */
function Breadcrumb({ ancestors }: { ancestors: EventRow[] }) {
  return (
    <nav className="mb-6 flex flex-wrap items-center gap-1.5 text-sm text-muted">
      <Link href="/events" className="hover:text-foreground">
        All events
      </Link>
      {ancestors.map((a) => (
        <span key={a.id} className="flex items-center gap-1.5">
          <ChevronRight className="size-3.5 shrink-0" />
          <Link href={`/events/${a.slug}`} className="hover:text-foreground">
            {a.title}
          </Link>
        </span>
      ))}
    </nav>
  );
}
