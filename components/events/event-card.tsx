import Link from "next/link";
import { CalendarDays, MapPin, ArrowUpRight, Lock, Layers } from "lucide-react";
import { EventThumb } from "./category-visual";
import { Badge } from "@/components/ui/badge";
import { EVENT_CATEGORY_LABELS } from "@/lib/constants";
import { formatEventDate, formatINR, cn } from "@/lib/utils";
import type { EventRow } from "@/types/database";

export function EventCard({
  event,
  className,
  registered,
  subEventCount = 0,
}: {
  event: EventRow;
  className?: string;
  registered?: boolean;
  /** >0 means this is a broader event that contains that many sub-events. */
  subEventCount?: number;
}) {
  const isContainer = subEventCount > 0;
  return (
    <Link
      href={`/events/${event.slug}`}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-[0_20px_50px_-24px_var(--brand)]",
        className,
      )}
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <div className="h-full w-full transition-transform duration-500 group-hover:scale-105">
          <EventThumb
            src={event.thumbnail_image ?? event.hero_image}
            alt={event.title}
            category={event.category}
          />
        </div>
        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          <Badge tone="brand">{EVENT_CATEGORY_LABELS[event.category]}</Badge>
          {isContainer && (
            <Badge tone="neutral">
              <Layers className="size-3" /> {subEventCount} events
            </Badge>
          )}
          {registered && <Badge tone="success">Registered</Badge>}
        </div>
        {!event.is_live ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60 text-center backdrop-blur-[1px]">
            <span className="flex size-11 items-center justify-center rounded-full border border-border bg-surface/85 text-brand">
              <Lock className="size-5" />
            </span>
            <span className="text-sm font-semibold text-foreground">Coming soon</span>
          </div>
        ) : (
          !isContainer &&
          !event.registration_open && (
            <div className="absolute right-3 top-3">
              <Badge tone="alert">Closed</Badge>
            </div>
          )
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-display text-xl font-semibold leading-snug text-foreground transition-colors group-hover:text-brand">
          {event.title}
        </h3>
        <p className="mt-2 line-clamp-2 text-sm text-muted">
          {event.short_description}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-3.5" /> {formatEventDate(event.event_date)}
          </span>
          {event.venue && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-3.5" /> {event.venue}
            </span>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
          {isContainer ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted">
              <Layers className="size-3.5" /> {subEventCount} sub-event
              {subEventCount === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="font-mono text-sm font-semibold text-foreground">
              {event.registration_fee === 0 ? "Free" : formatINR(event.registration_fee)}
            </span>
          )}
          {event.is_live ? (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-brand">
              {isContainer ? "View events" : "View"}
              <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-muted">
              <Lock className="size-3.5" /> Coming soon
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
