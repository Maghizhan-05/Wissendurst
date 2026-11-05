"use client";

import dynamic from "next/dynamic";
import type { EventCategory } from "@/lib/constants";
import { CATEGORY_COLORS, categoryVisual } from "@/lib/events/categories";
import { useEventCategories } from "@/components/events/categories-context";

const MoleculeField = dynamic(() => import("./molecule-field"), {
  ssr: false,
});

/** Small deterministic seed from the slug so each event drifts differently. */
function seedFrom(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 997;
  return (h % 100) / 16;
}

/**
 * Fixed, scroll-reactive 3D backdrop for an event page. Sits behind the page
 * content (content is z-10), pointer-events-none, and kept at low opacity so it
 * never competes with the text. Lazily loaded (three.js off the critical path)
 * and hidden on very small screens to protect mobile performance.
 */
export function EventBackground({
  category,
  slug,
}: {
  category: EventCategory;
  slug: string;
}) {
  const color = CATEGORY_COLORS[categoryVisual(useEventCategories(), category).color].hex;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 hidden opacity-40 [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_80%)] sm:block"
    >
      <MoleculeField seed={seedFrom(slug)} color={color} />
    </div>
  );
}
