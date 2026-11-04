import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { Reveal } from "@/components/motion/reveal";
import {
  Microscope,
  Trophy,
  Presentation,
  Users,
  Handshake,
  BadgeCheck,
  type LucideIcon,
} from "lucide-react";
import type { LandingContent } from "@/lib/content/landing";

const ICONS: LucideIcon[] = [
  Microscope,
  Trophy,
  Presentation,
  Users,
  Handshake,
  BadgeCheck,
];

export function WhyParticipate({ why }: { why: LandingContent["why"] }) {
  if (!why.visible) return null;
  return (
    <section className="border-y border-border bg-surface/40 py-20 md:py-28">
      <Container>
        <Reveal>
          <SectionHeading
            index={why.index}
            eyebrow={why.eyebrow}
            title={why.title}
            align="center"
          />
        </Reveal>
        <div className="mx-auto mt-14 grid max-w-5xl gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {why.points.map((p, i) => {
            const Icon = ICONS[i % ICONS.length];
            return (
              <Reveal key={`${p.title}-${i}`} delay={(i % 3) * 0.05}>
                <div className="h-full bg-surface p-7">
                  <Icon className="size-7 text-brand" strokeWidth={1.5} />
                  <h3 className="mt-4 font-display text-lg font-semibold text-foreground">
                    {p.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">
                    {p.body}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
