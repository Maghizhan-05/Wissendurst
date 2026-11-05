import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CategoryManager, type CategoryUsage } from "@/components/admin/category-manager";
import { requireScope } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getEventCategories } from "@/lib/data/event-categories";
import { getStoredEventFilterConfig } from "@/lib/data/event-filters";
import { getAboutContent, getLandingContent } from "@/lib/data/settings";
import { linksToCategory } from "@/lib/events/categories";
import { validateEventFilterConfig } from "@/lib/events/filter-config";

export const metadata: Metadata = { title: "Admin · Event categories" };

export default async function AdminEventCategoriesPage() {
  await requireScope("events");
  const supabase = await createClient();
  const [categories, eventsRes, storedFilters, landing, about] = await Promise.all([
    getEventCategories(),
    supabase.from("events").select("category"),
    getStoredEventFilterConfig(),
    getLandingContent(),
    getAboutContent(),
  ]);
  const eventCounts = new Map<string, number>();
  for (const e of (eventsRes.data ?? []) as { category: string }[])
    eventCounts.set(e.category, (eventCounts.get(e.category) ?? 0) + 1);
  const filters = validateEventFilterConfig(storedFilters);
  const groups = filters.ok ? filters.config.groups : [];

  const usage: Record<string, CategoryUsage> = {};
  for (const c of categories) {
    usage[c.id] = {
      events: eventCounts.get(c.slug) ?? 0,
      groups: groups.filter((g) => g.categories.includes(c.id)).map((g) => g.label),
      homepage: linksToCategory(landing, c.slug) || linksToCategory(about, c.slug),
    };
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/admin/events"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to events
      </Link>
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">Event categories</h1>
        <p className="mt-1 text-sm text-muted">
          Every event belongs to one category. Add, rename, restyle and reorder them here; choose which categories
          each public tab shows in{" "}
          <Link href="/admin/events/filters" className="font-medium text-brand hover:underline">
            Filter tabs
          </Link>
          .
        </p>
      </div>
      {eventsRes.error && (
        <p role="alert" className="rounded-lg border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert">
          Event usage couldn&rsquo;t be loaded, so counts may be missing. The database still refuses deleting a
          category in use.
        </p>
      )}
      <CategoryManager categories={categories} usage={usage} />
    </div>
  );
}
