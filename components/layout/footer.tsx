import Link from "next/link";
import { Container } from "@/components/ui/container";
import { SITE } from "@/lib/constants";
import { DEFAULT_LANDING, type LandingContent } from "@/lib/content/landing";

export function Footer({
  footer = DEFAULT_LANDING.footer,
}: {
  footer?: LandingContent["footer"];
}) {
  return (
    <footer className="mt-24 border-t border-border bg-surface/50">
      <Container className="grid gap-10 py-14 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="font-display text-2xl font-semibold text-foreground">
            {SITE.name}
          </p>
          <p className="mt-3 max-w-sm text-sm text-muted">
            {[footer.tagline, footer.description]
              .filter(Boolean)
              .map((t) => t.replace(/[.\s]+$/, ""))
              .join(". ")}
            {footer.tagline || footer.description ? "." : ""}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            {footer.exploreHeading}
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            <li><Link href="/events" className="text-foreground hover:text-brand">Events</Link></li>
            <li><Link href="/schedule" className="text-foreground hover:text-brand">Schedule</Link></li>
            <li><Link href="/about" className="text-foreground hover:text-brand">About</Link></li>
            <li><Link href="/signup" className="text-foreground hover:text-brand">Sign up</Link></li>
          </ul>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            {footer.contactHeading}
          </p>
          <ul className="mt-4 space-y-2 text-sm text-muted">
            {footer.contactName && <li>{footer.contactName}</li>}
            {/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(footer.contactEmail) ? (
              <li><a href={`mailto:${footer.contactEmail}`} className="hover:text-brand">{footer.contactEmail}</a></li>
            ) : (
              footer.contactEmail && <li>{footer.contactEmail}</li>
            )}
            {footer.dates && <li>{footer.dates}</li>}
          </ul>
        </div>
      </Container>

      <div className="border-t border-border">
        <Container className="flex flex-col items-center justify-between gap-2 py-6 text-xs text-muted sm:flex-row">
          <p>© {new Date().getFullYear()} {SITE.name}. All rights reserved.</p>
          {footer.bottomNote && <p>{footer.bottomNote}</p>}
        </Container>
      </div>
    </footer>
  );
}
