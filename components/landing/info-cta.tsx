import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { Reveal } from "@/components/motion/reveal";
import { ButtonLink } from "@/components/ui/button";
import {
  CalendarDays,
  MapPin,
  Clock,
  Mail,
  GraduationCap,
  Info as InfoIcon,
  type LucideIcon,
} from "lucide-react";
import { safeHrefOr } from "@/components/content/safe-link";
import type { LandingContent } from "@/lib/content/landing";

const ICONS: LucideIcon[] = [CalendarDays, MapPin, Clock, GraduationCap, Mail];

export function ImportantInfo({ info }: { info: LandingContent["info"] }) {
  if (!info.visible) return null;
  return (
    <section className="py-20 md:py-28">
      <Container>
        <Reveal>
          <SectionHeading index={info.index} eyebrow={info.eyebrow} title={info.title} />
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {info.items.map((item, i) => {
            const Icon = ICONS[i % ICONS.length] ?? InfoIcon;
            return (
              <Reveal key={`${item.label}-${i}`} delay={(i % 3) * 0.05}>
                <div className="flex items-start gap-4 rounded-2xl border border-border bg-surface p-6">
                  <Icon className="mt-0.5 size-5 shrink-0 text-brand" />
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">
                      {item.label}
                    </p>
                    <p className="mt-1 font-medium text-foreground">{item.value}</p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </Container>
    </section>
  );
}

export function FinalCta({ finalCta }: { finalCta: LandingContent["finalCta"] }) {
  if (!finalCta.visible) return null;
  return (
    <section className="py-20 md:py-28">
      <Container>
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-brand/30 bg-surface px-6 py-16 text-center md:py-24">
            <div className="brand-glow pointer-events-none absolute inset-0" />
            <div className="medical-grid pointer-events-none absolute inset-0 opacity-40" />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl font-display text-4xl font-semibold leading-tight text-foreground sm:text-5xl md:text-6xl">
                {finalCta.title}
              </h2>
              <p className="mx-auto mt-5 max-w-md text-muted">{finalCta.description}</p>
              <div className="mt-9 flex flex-wrap justify-center gap-3">
                {finalCta.ctaPrimary && (
                  <ButtonLink href={safeHrefOr(finalCta.ctaPrimaryHref, "/signup")} size="lg" withArrow>
                    {finalCta.ctaPrimary}
                  </ButtonLink>
                )}
                {finalCta.ctaSecondary && (
                  <ButtonLink
                    href={safeHrefOr(finalCta.ctaSecondaryHref, "/events")}
                    size="lg"
                    variant="outline"
                    withArrow
                  >
                    {finalCta.ctaSecondary}
                  </ButtonLink>
                )}
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
