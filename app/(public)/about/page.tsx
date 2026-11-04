import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { ButtonLink } from "@/components/ui/button";
import { EcgDivider } from "@/components/ui/misc";

export const metadata: Metadata = {
  title: "About",
  description:
    "About Wissendurst'27 — a student-led medical symposium built for the clinically curious.",
};

const FACTS = [
  { k: "3", v: "days of programme" },
  { k: "6", v: "event tracks" },
  { k: "1", v: "participant ID, all events" },
];

export default function AboutPage() {
  return (
    <div className="py-14 md:py-20">
      <Container>
        <SectionHeading
          eyebrow="About"
          title="A symposium built by students, for students."
          description="Wissendurst'27 is a medical college symposium that puts curiosity on a stage. We bring together workshops, debate, and original research into three intense, rewarding days."
        />

        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {FACTS.map((f) => (
            <div
              key={f.v}
              className="rounded-2xl border border-border bg-surface p-6"
            >
              <p className="font-display text-4xl font-semibold text-brand">
                {f.k}
              </p>
              <p className="mt-1 text-sm text-muted">{f.v}</p>
            </div>
          ))}
        </div>

        <EcgDivider className="my-14" />

        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl font-semibold text-foreground">
              What we stand for
            </h2>
            <p className="mt-4 leading-relaxed text-muted">
              Medicine advances by asking better questions. Wissendurst exists to
              reward that instinct — to give students a place to test skills, argue
              ideas, and present work to people who take it seriously. No gate-keeping,
              no filler. Just a well-run event where good work gets seen.
            </p>
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-foreground">
              Who can take part
            </h2>
            <p className="mt-4 leading-relaxed text-muted">
              Under- and post-graduate students across medicine, dentistry, nursing,
              and the allied health sciences — from any institution. Some events have
              specific eligibility; each event page states its own rules and capacity.
            </p>
          </div>
        </div>

        <div className="mt-14 flex flex-wrap gap-3">
          <ButtonLink href="/events" size="lg" withArrow>
            Explore Events
          </ButtonLink>
          <ButtonLink href="/signup" size="lg" variant="outline" withArrow>
            Register
          </ButtonLink>
        </div>
      </Container>
    </div>
  );
}
