import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { ButtonLink } from "@/components/ui/button";
import { EcgDivider } from "@/components/ui/misc";
import { safeHrefOr } from "@/components/content/safe-link";
import { getAboutContent } from "@/lib/data/settings";
import { paragraphs } from "@/lib/content/about";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const about = await getAboutContent();
  return { title: "About", description: about.metaDescription };
}

/** About page — every visible string comes from the admin-managed settings. */
export default async function AboutPage() {
  const about = await getAboutContent();
  const facts = about.facts.visible ? about.facts.items : [];
  const sections = about.sections.filter((s) => s.visible);
  const cta = about.cta;
  const showCta = cta.visible && (cta.primaryLabel || cta.secondaryLabel);

  return (
    <div className="py-14 md:py-20">
      <Container>
        <SectionHeading
          eyebrow={about.eyebrow}
          title={about.title}
          description={about.intro}
        />

        {facts.length > 0 && (
          <dl
            className={cn(
              "mt-12 grid gap-6",
              facts.length === 2 && "sm:grid-cols-2",
              facts.length === 4 && "sm:grid-cols-2 lg:grid-cols-4",
              (facts.length === 3 || facts.length >= 5) && "sm:grid-cols-3",
            )}
          >
            {facts.map((f) => (
              <div
                key={f.id}
                className="flex flex-col-reverse rounded-2xl border border-border bg-surface p-6"
              >
                <dt className="mt-1 text-sm text-muted">{f.label}</dt>
                <dd className="font-display text-4xl font-semibold text-brand">
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {sections.length > 0 && (
          <>
            <EcgDivider className="my-14" />
            <div className={cn("grid gap-10", sections.length > 1 && "lg:grid-cols-2")}>
              {sections.map((s) => (
                <section key={s.id}>
                  <h2 className="font-display text-2xl font-semibold text-foreground">
                    {s.heading}
                  </h2>
                  {paragraphs(s.body).map((p, i) => (
                    <p key={i} className="mt-4 leading-relaxed text-muted">
                      {p}
                    </p>
                  ))}
                </section>
              ))}
            </div>
          </>
        )}

        {showCta && (
          <div className="mt-14 flex flex-wrap gap-3">
            {cta.primaryLabel && (
              <ButtonLink href={safeHrefOr(cta.primaryHref, "/events")} size="lg" withArrow>
                {cta.primaryLabel}
              </ButtonLink>
            )}
            {cta.secondaryLabel && (
              <ButtonLink
                href={safeHrefOr(cta.secondaryHref, "/signup")}
                size="lg"
                variant="outline"
                withArrow
              >
                {cta.secondaryLabel}
              </ButtonLink>
            )}
          </div>
        )}
      </Container>
    </div>
  );
}
