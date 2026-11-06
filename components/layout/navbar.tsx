"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X, LayoutDashboard, Shield, Ticket } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { SocialMenu } from "./social-menu";
import type { SocialLink } from "@/lib/content/social";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";
import { SITE } from "@/lib/constants";

type NavUser = {
  participantId: string;
  isAdmin: boolean;
  /** Approved participant still on a standard E id (hidden after GR verification). */
  showGeneralRegistration?: boolean;
} | null;

const LINKS = [
  { href: "/events", label: "Events" },
  { href: "/schedule", label: "Schedule" },
  { href: "/about", label: "About" },
];

export function Navbar({ user, socialLinks = [] }: { user: NavUser; socialLinks?: SocialLink[] }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-all duration-300",
        scrolled
          ? "border-b border-border bg-background/85 backdrop-blur-xl"
          : "border-b border-transparent",
      )}
    >
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link
          href="/"
          className="font-display text-lg font-semibold tracking-tight text-foreground"
        >
          {SITE.name}
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-full px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground",
                pathname.startsWith(l.href) && "text-foreground",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          <SocialMenu links={socialLinks} />
          {user?.isAdmin && (
            <ButtonLink href="/admin" variant="ghost" size="sm">
              <Shield className="size-4" /> Admin
            </ButtonLink>
          )}
          {user?.showGeneralRegistration && (
            <ButtonLink href="/general-registration" variant="outline" size="sm">
              <Ticket className="size-4" aria-hidden /> General Registration
            </ButtonLink>
          )}
          {user ? (
            <ButtonLink href="/dashboard" variant="secondary" size="sm">
              <LayoutDashboard className="size-4" /> {user.participantId}
            </ButtonLink>
          ) : (
            <>
              <ButtonLink href="/login" variant="ghost" size="sm">
                Sign in
              </ButtonLink>
              <ButtonLink href="/signup" size="sm" withArrow>
                Sign up
              </ButtonLink>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <SocialMenu links={socialLinks} />
          <button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex size-10 items-center justify-center rounded-full border border-border text-foreground"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </Container>

      {open && (
        <div className="border-t border-border bg-background md:hidden">
          <Container className="flex flex-col gap-1 py-4">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-xl px-3 py-3 text-base font-medium text-foreground hover:bg-surface-2"
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2">
              {user?.isAdmin && (
                <ButtonLink href="/admin" variant="secondary" className="w-full">
                  <Shield className="size-4" /> Admin
                </ButtonLink>
              )}
              {user?.showGeneralRegistration && (
                <ButtonLink href="/general-registration" variant="outline" className="w-full">
                  <Ticket className="size-4" aria-hidden /> General Registration
                </ButtonLink>
              )}
              {user ? (
                <ButtonLink href="/dashboard" variant="secondary" className="w-full">
                  Dashboard · {user.participantId}
                </ButtonLink>
              ) : (
                <>
                  <ButtonLink href="/login" variant="secondary" className="w-full">
                    Sign in
                  </ButtonLink>
                  <ButtonLink href="/signup" className="w-full" withArrow>
                    Sign up
                  </ButtonLink>
                </>
              )}
            </div>
          </Container>
        </div>
      )}
    </header>
  );
}
