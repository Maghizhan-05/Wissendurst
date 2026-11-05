"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { EventCard } from "./event-card";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { useEventCategories } from "./categories-context";
import {
  defaultEventFilterConfig,
  matchesFilter,
  resolveActiveFilter,
  visibleGroups,
  type ActiveFilter,
  type EventFilterConfig,
} from "@/lib/events/filter-config";
import type { EventRow } from "@/types/database";

type SortKey = "date" | "fee-asc" | "fee-desc" | "title";

export function EventsExplorer({
  events,
  registeredIds,
  subEventCounts = {},
  discounts = {},
  initialCategory,
  filterConfig: filterConfigProp,
}: {
  /** Admin-configured filter bar (0025); defaults to one tab per category. */
  filterConfig?: EventFilterConfig;
  events: EventRow[];
  registeredIds: string[];
  subEventCounts?: Record<string, number>;
  discounts?: Record<string, number>;
  initialCategory?: string;
}) {
  const [query, setQuery] = useState("");
  const categories = useEventCategories();
  const filterConfig = filterConfigProp ?? defaultEventFilterConfig(categories);
  const groups = visibleGroups(filterConfig);
  const [filter, setFilter] = useState<ActiveFilter>(() =>
    resolveActiveFilter(filterConfig, categories, initialCategory),
  );
  // Events carry the category slug; groups reference category ids.
  const categoryIdBySlug = useMemo(
    () => new Map(categories.map((c) => [c.slug, c.id])),
    [categories],
  );
  const [sort, setSort] = useState<SortKey>("date");

  const registered = useMemo(() => new Set(registeredIds), [registeredIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = events.filter((e) => {
      const matchesCat = matchesFilter(filter, categoryIdBySlug.get(e.category));
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
  }, [events, query, filter, sort, categoryIdBySlug]);

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

      <div
        role="group"
        aria-label="Filter events by category"
        className="mt-5 flex flex-wrap gap-2"
      >
        <FilterChip active={filter.kind === "all"} onClick={() => setFilter({ kind: "all" })}>
          {filterConfig.allLabel}
        </FilterChip>
        {groups.map((g) => (
          <FilterChip
            key={g.id}
            active={filter.kind === "group" && filter.group.id === g.id}
            onClick={() => setFilter({ kind: "group", group: g })}
          >
            {g.label}
          </FilterChip>
        ))}
        {/* Legacy ?category= link whose category no tab covers on its own. */}
        {filter.kind === "category" && (
          <FilterChip active onClick={() => setFilter({ kind: "all" })}>
            {filter.category.label}
            <X className="size-3.5" aria-hidden />
            <span className="sr-only"> (show all)</span>
          </FilterChip>
        )}
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
              discountPaise={discounts[event.id] ?? 0}
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
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        // 44px effective touch target on mobile; original compact size from sm up.
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors sm:min-h-0",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active
          ? "border-brand bg-brand text-brand-contrast"
          : "border-border text-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
