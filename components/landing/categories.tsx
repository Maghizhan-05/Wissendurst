import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { Reveal } from "@/components/motion/reveal";
import { ContentIcon } from "@/components/content/content-icon";
import { SafeLink } from "@/components/content/safe-link";
import { cn } from "@/lib/utils";
import type { LandingContent } from "@/lib/content/landing";

/**
 * Admin-managed homepage boxes (0–6, ordered). Layout adapts to the count:
 * rows stay balanced and a short last row is centred. Nothing renders when
 * the section is hidden or no box is enabled.
 */
export function Categories({
  categories,
}: {
  categories: LandingContent["categories"];
}) {
  const boxes = categories.boxes.filter((b) => b.enabled);
  if (!categories.visible || boxes.length === 0) return null;
  const n = boxes.length;

  // Card width per breakpoint for n cards (gap-4 = 1rem).
  const itemWidth = cn(
    "w-full",
    n >= 2 && "sm:w-[calc(50%-0.5rem)]",
    (n === 3 || n >= 5) && "lg:w-[calc(33.333%-0.667rem)]",
    n === 4 && "lg:w-[calc(25%-0.75rem)]",
  );

  return (
    <section className="py-20 md:py-28" aria-labelledby="home-boxes-heading">
      <Container>
        <Reveal>
          <SectionHeading
            index={categories.index}
            eyebrow={categories.eyebrow}
            title={<span id="home-boxes-heading">{categories.title}</span>}
            description={categories.description}
          />
        </Reveal>

        <ul
          className={cn(
            "mt-14 flex flex-wrap justify-center gap-4",
            n === 1 && "mx-auto max-w-md",
            n === 2 && "mx-auto max-w-3xl",
          )}
        >
          {boxes.map((box, i) => (
            <Reveal key={box.id} as="li" delay={i * 0.05} className={itemWidth}>
              <SafeLink
                href={box.href}
                className="group flex h-full flex-col rounded-2xl border border-border bg-surface p-6 transition-all duration-300 hover:-translate-y-1 hover:border-brand/40"
              >
                <span className="flex size-12 items-center justify-center rounded-xl bg-brand/10 text-brand transition-colors group-hover:bg-brand group-hover:text-brand-contrast">
                  <ContentIcon name={box.icon} className="size-6" strokeWidth={1.5} />
                </span>
                <span className="mt-5 font-display text-xl font-semibold text-foreground">
                  {box.title}
                </span>
                {box.description && (
                  <span className="mt-2 text-sm text-muted">{box.description}</span>
                )}
                <span className="mt-auto pt-4 text-sm font-medium text-brand">
                  {box.linkLabel} <span aria-hidden>→</span>
                </span>
              </SafeLink>
            </Reveal>
          ))}
        </ul>
      </Container>
    </section>
  );
}
