import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { Reveal } from "@/components/motion/reveal";
import {
  Compass,
  ClipboardList,
  QrCode,
  ShieldCheck,
  PartyPopper,
  type LucideIcon,
} from "lucide-react";
import type { LandingContent } from "@/lib/content/landing";

const ICONS: LucideIcon[] = [
  Compass,
  ClipboardList,
  QrCode,
  ShieldCheck,
  PartyPopper,
];

export function Journey({ journey }: { journey: LandingContent["journey"] }) {
  if (!journey.visible) return null;
  return (
    <section className="py-20 md:py-28">
      <Container>
        <Reveal>
          <SectionHeading
            index={journey.index}
            eyebrow={journey.eyebrow}
            title={journey.title}
          />
        </Reveal>

        <ol className="mt-14 grid gap-4 md:grid-cols-5">
          {journey.steps.map((s, i) => {
            const Icon = ICONS[i % ICONS.length];
            return (
              <Reveal key={`${s.title}-${i}`} delay={i * 0.07} as="li">
                <div className="relative flex h-full flex-col rounded-2xl border border-border bg-surface p-6">
                  <span className="font-mono text-xs text-brand">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Icon className="mt-3 size-7 text-brand" strokeWidth={1.5} />
                  <h3 className="mt-4 font-display text-lg font-semibold text-foreground">
                    {s.title}
                  </h3>
                  <p className="mt-1.5 text-sm text-muted">{s.body}</p>
                  {i < journey.steps.length - 1 && (
                    <span className="absolute -right-2 top-1/2 hidden -translate-y-1/2 text-brand/40 md:block">
                      →
                    </span>
                  )}
                </div>
              </Reveal>
            );
          })}
        </ol>
      </Container>
    </section>
  );
}
