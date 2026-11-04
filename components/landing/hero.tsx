import { CalendarDays, MapPin } from "lucide-react";
import { HeroScene } from "@/components/three/hero-scene";
import { Reveal } from "@/components/motion/reveal";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { safeHrefOr } from "@/components/content/safe-link";
import type { LandingContent } from "@/lib/content/landing";

export function Hero({ hero }: { hero: LandingContent["hero"] }) {
  return (
    <section className="relative overflow-hidden">
      <div className="brand-glow pointer-events-none absolute inset-x-0 top-0 h-[600px]" />
      <Container className="relative grid min-h-[calc(100svh-4rem)] items-center gap-8 py-16 lg:grid-cols-[1.15fr_0.85fr] lg:py-0">
        <div className="relative z-10">
          <Reveal>
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-brand backdrop-blur">
              {hero.eyebrow}
            </p>
          </Reveal>

          <Reveal delay={0.05}>
            <h1 className="mt-6 font-display text-5xl font-semibold leading-[0.95] tracking-tight text-foreground sm:text-6xl md:text-7xl xl:text-8xl">
              {hero.titleLine1}
              <span className="text-brand">{hero.titleAccent}</span>
            </h1>
          </Reveal>

          <Reveal delay={0.12}>
            <p className="mt-4 font-display text-2xl font-medium leading-tight text-foreground/90 sm:text-3xl md:text-4xl">
              {hero.taglineLine1} <br className="hidden sm:block" />
              {hero.taglineLine2}
            </p>
          </Reveal>

          <Reveal delay={0.2}>
            <p className="mt-6 max-w-md text-base leading-relaxed text-muted">
              {hero.description}
            </p>
          </Reveal>

          <Reveal delay={0.28}>
            <div className="mt-8 flex flex-wrap items-center gap-4 text-sm text-muted">
              <span className="inline-flex items-center gap-2">
                <CalendarDays className="size-4 text-brand" /> {hero.date}
              </span>
              <span className="hidden h-4 w-px bg-border sm:block" />
              <span className="inline-flex items-center gap-2">
                <MapPin className="size-4 text-brand" /> {hero.venue}
              </span>
            </div>
          </Reveal>

          <Reveal delay={0.36}>
            <div className="mt-9 flex flex-wrap gap-3">
              {hero.ctaPrimary && (
                <ButtonLink href={safeHrefOr(hero.ctaPrimaryHref, "/signup")} size="lg" withArrow>
                  {hero.ctaPrimary}
                </ButtonLink>
              )}
              {hero.ctaSecondary && (
                <ButtonLink
                  href={safeHrefOr(hero.ctaSecondaryHref, "/events")}
                  size="lg"
                  variant="outline"
                  withArrow
                >
                  {hero.ctaSecondary}
                </ButtonLink>
              )}
            </div>
          </Reveal>
        </div>

        <div className="relative h-[340px] w-full sm:h-[440px] lg:h-[560px]">
          <HeroScene className="absolute inset-0" />
        </div>
      </Container>
    </section>
  );
}
