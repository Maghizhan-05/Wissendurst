import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { isExternalHref, isSafeHref } from "@/lib/content/validation";
import { cn } from "@/lib/utils";

/**
 * Renders an admin-configured link. Internal paths use next/link; external
 * https links open in a new tab with noopener. Anything that fails the
 * allowlist at render time is rendered as plain text (never as a link).
 */
export function SafeLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (!isSafeHref(href)) return <span className={className}>{children}</span>;
  if (isExternalHref(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cn(className)}>
        {children}
        <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/** href usable by ButtonLink: unsafe values fall back to `fallback`. */
export function safeHrefOr(href: string, fallback: string): string {
  return isSafeHref(href) ? href : fallback;
}
