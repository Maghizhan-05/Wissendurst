import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { Reveal } from "@/components/motion/reveal";
import { EcgDivider } from "@/components/ui/misc";
import type { LandingContent } from "@/lib/content/landing";

export function Intro({ intro }: { intro: LandingContent["intro"] }) {
  if (!intro.visible) return null;
  return (
    <section className="py-20 md:py-28">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <Reveal>
            <SectionHeading
              index={intro.index}
              eyebrow={intro.eyebrow}
              title={intro.title}
            />
          </Reveal>
          <Reveal delay={0.1}>
            <div className="space-y-5 text-lg leading-relaxed text-muted">
              {intro.paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </Reveal>
        </div>
        <EcgDivider className="mt-16" />
      </Container>
    </section>
  );
}
