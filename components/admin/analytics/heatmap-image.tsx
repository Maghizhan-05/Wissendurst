"use client";

import { useCallback, useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A saved-heatmap screenshot served by the same-origin super-admin proxy
 * (never directly from PostHog). Shows a skeleton while loading and a clear
 * failure state when the proxy answers with an error (processing, rejected,
 * missing scope or a failed render).
 */
export function HeatmapImage({
  src,
  alt,
  className,
  fit = "top",
}: {
  src: string;
  alt: string;
  className?: string;
  fit?: "top" | "full";
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  // The image may finish (from cache) before hydration attaches onLoad/onError,
  // so also settle the state from the element itself when it mounts.
  const settle = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete) setState(img.naturalWidth > 0 ? "ready" : "error");
  }, []);
  return (
    <div className={cn("relative overflow-hidden bg-surface-2", className)}>
      {state === "loading" && <div aria-hidden className="absolute inset-0 animate-pulse bg-surface-2" />}
      {state === "error" ? (
        <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted">
          <ImageOff className="size-5" aria-hidden />
          Screenshot unavailable — it may still be rendering, or the render failed.
        </div>
      ) : (
        // A private, authenticated, streamed image: next/image optimization does not apply.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={settle}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setState("ready")}
          onError={() => setState("error")}
          className={cn(
            "block w-full transition-opacity duration-300",
            fit === "top" ? "h-full object-cover object-top" : "h-auto",
            state === "ready" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  );
}
