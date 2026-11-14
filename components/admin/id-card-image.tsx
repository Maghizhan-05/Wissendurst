import { ExternalLink, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A participant's private college ID card, shown from a short-lived signed URL
 * (getIdCardSignedUrl, Users scope). Server component; renders nothing secret
 * beyond the 10-minute URL itself.
 */
export function IdCardImage({
  url,
  hasCard,
  className,
  compact = false,
}: {
  url: string | null;
  /** Whether the profile has an uploaded card at all. */
  hasCard: boolean;
  className?: string;
  compact?: boolean;
}) {
  if (!url) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-center text-muted",
          compact ? "h-28 p-3" : "h-56 p-4",
          className,
        )}
      >
        <ImageOff className={compact ? "size-5" : "size-7"} aria-hidden />
        <p className="text-xs">{hasCard ? "ID card couldn’t be loaded — reload to retry" : "No ID card uploaded"}</p>
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group relative block overflow-hidden rounded-xl border border-border bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      title="Open full size"
    >
      {/* Private, short-lived signed URL: next/image optimisation does not apply. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="College ID card"
        referrerPolicy="no-referrer"
        className={cn("w-full object-contain", compact ? "max-h-40" : "max-h-[520px]")}
      />
      <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/85 px-2 py-0.5 text-[11px] font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <ExternalLink className="size-3" aria-hidden /> Full size
      </span>
    </a>
  );
}
