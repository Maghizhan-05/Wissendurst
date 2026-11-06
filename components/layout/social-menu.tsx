"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ExternalLink, Share2 } from "lucide-react";
import { SocialGlyph } from "@/components/layout/social-glyph";
import { SOCIAL_LABELS, type SocialLink } from "@/lib/content/social";
import { SITE } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** Button beside the theme switch that opens the site's social links. */
export function SocialMenu({ links }: { links: SocialLink[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close on navigation.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  if (links.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Social links"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex size-10 items-center justify-center rounded-full border text-foreground transition-colors hover:bg-surface-2",
          open ? "border-brand bg-surface-2" : "border-border",
        )}
      >
        <Share2 className="size-[18px]" aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          className="absolute right-0 top-12 z-50 w-60 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-surface p-1.5 shadow-2xl"
        >
          <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-muted">
            Follow {SITE.name}
          </p>
          <ul>
            {links.map((l, i) => (
              <li key={`${l.platform}-${i}`}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-foreground hover:bg-surface-2"
                >
                  <SocialGlyph p={l.platform} className="text-brand" />
                  {SOCIAL_LABELS[l.platform]}
                  <ExternalLink className="ml-auto size-3.5 text-muted" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
