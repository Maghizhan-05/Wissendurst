import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/content", label: "Home page", preview: "/" },
  { href: "/admin/content/about", label: "About page", preview: "/about" },
  { href: "/admin/content/appearance", label: "Appearance", preview: "/" },
  { href: "/admin/content/social", label: "Social links", preview: "/" },
] as const;

/** Header + tabs shared by the site-content admin pages. */
export function ContentNav({
  active,
  title,
  description,
}: {
  active: (typeof TABS)[number]["href"];
  title: string;
  description: string;
}) {
  const current = TABS.find((t) => t.href === active)!;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted">{description}</p>
        </div>
        <a
          href={current.preview}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
        >
          Preview <ArrowUpRight className="size-4" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      <nav aria-label="Site content sections" className="flex flex-wrap gap-2 border-b border-border pb-3">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.href === active ? "page" : undefined}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium transition-colors",
              t.href === active
                ? "bg-brand text-brand-contrast"
                : "text-muted hover:bg-surface-2 hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
