"use client";

import { createContext, useContext } from "react";
import {
  SEED_EVENT_CATEGORIES,
  categoryLabel,
  type EventCategoryInfo,
} from "@/lib/events/categories";

const CategoriesContext = createContext<EventCategoryInfo[]>(SEED_EVENT_CATEGORIES);

/** Provides the event-category list (read once in the root layout). */
export function CategoriesProvider({
  categories,
  children,
}: {
  categories: EventCategoryInfo[];
  children: React.ReactNode;
}) {
  return <CategoriesContext.Provider value={categories}>{children}</CategoriesContext.Provider>;
}

export function useEventCategories(): EventCategoryInfo[] {
  return useContext(CategoriesContext);
}

/** A category's current label (plain text; usable from Server Components). */
export function CategoryName({ slug }: { slug: string }) {
  return <>{categoryLabel(useEventCategories(), slug)}</>;
}
