"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { EventCard } from "./event-card";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import {
  EVENT_CATEGORIES,
  EVENT_CATEGORY_LABELS,
  type EventCategory,
} from "@/lib/constants";
import type { EventRow } from "@/types/database";

type SortKey = "date" | "fee-asc" | "fee-desc" | "title";

export function EventsExplorer({
  events,
  registeredIds,
  subEventCounts = {},
  initialCategory,
}: {
  events: EventRow[];
  registeredIds: string[];
  subEventCounts?: Record<string, number>;
  initialCategory?: string;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<EventCategory | "all">(
    (EVENT_CATEGORIES as readonly string[]).includes(initialCategory ?? "")
      ? (initialCategory as EventCategory)
      : "all",
  );
  const [sort, setSort] = useState<SortKey>("date");

  const registered = useMemo(() => new Set(registeredIds), [registeredIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = events.filter((e) => {
      const matchesCat = category === "all" || e.category === category;
      const matchesQuery =
        !q ||
        e.title.toLowerCase().includes(q) ||
        e.short_description.toLowerCase().includes(q) ||
        (e.venue ?? "").toLowerCase().includes(q);
      return matchesCat && matchesQuery;
    });

    list = [...list].sort((a, b) => {
      switch (sort) {
        case "fee-asc":
          return a.registration_fee - b.registration_fee;
        case "fee-desc":
          return b.registration_fee - a.registration_fee;
        case "title":
          return a.title.localeCompare(b.title);
        default:
          return (a.event_date ?? "9999").localeCompare(b.event_date ?? "9999");
      }
    });
    return list;
  }, [events, query, category, sort]);

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events, venues…"
            className="pl-10"
            aria-label="Search events"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort events"
            className="w-auto"
          >
            <option value="date">Sort: Date</option>
            <option value="fee-asc">Fee: Low to High</option>
            <option value="fee-desc">Fee: High to Low</option>
            <option value="title">Title: A–Z</option>
          </Select>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <FilterChip active={category === "all"} onClick={() => setCategory("all")}>
          All
        </FilterChip>
        {EVENT_CATEGORIES.map((c) => (
          <FilterChip
            key={c}
            active={category === c}
            onClick={() => setCategory(c)}
          >
            {EVENT_CATEGORY_LABELS[c]}
          </FilterChip>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            title="No events match"
            description="Try a different search term or category filter."
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              registered={registered.has(event.id)}
              subEventCount={subEventCounts[event.id] ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-brand bg-brand text-brand-contrast"
          : "border-border text-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
