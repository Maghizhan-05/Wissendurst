"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { EventCategory } from "@/lib/constants";
import { CATEGORY_COLORS, categoryVisual } from "@/lib/events/categories";
import { CATEGORY_ICON } from "./category-meta";
import { useEventCategories } from "./categories-context";

function Placeholder({
  category,
  className,
}: {
  category: EventCategory;
  className?: string;
}) {
  // Allowlisted icon/tint keys only; unknown values fall back to `other`'s look.
  const visual = categoryVisual(useEventCategories(), category);
  const Icon = CATEGORY_ICON[visual.icon];
  return (
    <div
      className={cn(
        "relative h-full w-full bg-gradient-to-br to-surface-2",
        CATEGORY_COLORS[visual.color].hue,
        className,
      )}
      aria-hidden
    >
      <div className="medical-grid absolute inset-0 opacity-60" />
      <div className="absolute inset-0 flex items-center justify-center">
        <Icon className="size-16 text-brand/60" strokeWidth={1.25} />
      </div>
    </div>
  );
}

/**
 * Event thumbnail: real image when provided, otherwise an art-directed
 * placeholder with the category glyph over a clinical grid.
 *
 * Images render `unoptimized` so ANY URL an admin supplies works — Supabase
 * Storage, Pexels, or elsewhere — without listing each host in next.config.
 * If a URL fails to load, we fall back to the placeholder instead of a broken
 * image.
 */
export function EventThumb({
  src,
  alt,
  category,
  className,
  sizes,
  priority,
}: {
  src: string | null;
  alt: string;
  category: EventCategory;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return <Placeholder category={category} className={className} />;
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes ?? "(max-width: 768px) 100vw, 33vw"}
      priority={priority}
      unoptimized
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
    />
  );
}
