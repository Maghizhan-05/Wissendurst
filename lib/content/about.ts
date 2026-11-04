/**
 * Editable About-page content. DEFAULT_ABOUT is the built-in copy and the
 * emergency fallback; stored JSON is merged over it field by field.
 */
import { z } from "zod";
import { mergeFields, mergeList } from "./merge.ts";
import { newStableId, safeHref, stableId, text } from "./validation.ts";

export interface AboutFact {
  id: string;
  value: string;
  label: string;
}

export interface AboutSection {
  id: string;
  visible: boolean;
  heading: string;
  /** Plain text; blank lines separate paragraphs. */
  body: string;
}

export interface AboutContent {
  metaDescription: string;
  eyebrow: string;
  title: string;
  intro: string;
  facts: { visible: boolean; items: AboutFact[] };
  sections: AboutSection[];
  cta: {
    visible: boolean;
    primaryLabel: string;
    primaryHref: string;
    secondaryLabel: string;
    secondaryHref: string;
  };
}

export const MAX_ABOUT_FACTS = 6;
export const MAX_ABOUT_SECTIONS = 8;

export const DEFAULT_ABOUT: AboutContent = {
  metaDescription:
    "About Wissendurst'27 — a student-led medical symposium built for the clinically curious.",
  eyebrow: "About",
  title: "A symposium built by students, for students.",
  intro:
    "Wissendurst'27 is a medical college symposium that puts curiosity on a stage. We bring together workshops, debate, and original research into three intense, rewarding days.",
  facts: {
    visible: true,
    items: [
      { id: "fact-days", value: "3", label: "days of programme" },
      { id: "fact-tracks", value: "6", label: "event tracks" },
      { id: "fact-id", value: "1", label: "participant ID, all events" },
    ],
  },
  sections: [
    {
      id: "section-values",
      visible: true,
      heading: "What we stand for",
      body: "Medicine advances by asking better questions. Wissendurst exists to reward that instinct — to give students a place to test skills, argue ideas, and present work to people who take it seriously. No gate-keeping, no filler. Just a well-run event where good work gets seen.",
    },
    {
      id: "section-eligibility",
      visible: true,
      heading: "Who can take part",
      body: "Under- and post-graduate students across medicine, dentistry, nursing, and the allied health sciences — from any institution. Some events have specific eligibility; each event page states its own rules and capacity.",
    },
  ],
  cta: {
    visible: true,
    primaryLabel: "Explore Events",
    primaryHref: "/events",
    secondaryLabel: "Register",
    secondaryHref: "/signup",
  },
};

const factSchema = z.object({
  id: stableId,
  value: text(12).min(1, "Each fact needs a value"),
  label: text(80).min(1, "Each fact needs a label"),
});
const sectionSchema = z.object({
  id: stableId,
  visible: z.boolean(),
  heading: text(120).min(1, "Each section needs a heading"),
  body: text(3000),
});

const uniqueIds = <T extends { id: string }>(label: string) =>
  (items: T[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    items.forEach((it, i) => {
      if (seen.has(it.id))
        ctx.addIssue({ code: "custom", path: [i, "id"], message: `Duplicate ${label} id` });
      seen.add(it.id);
    });
  };

const factsShape = {
  visible: z.boolean(),
  items: z
    .array(factSchema)
    .max(MAX_ABOUT_FACTS, `At most ${MAX_ABOUT_FACTS} facts`)
    .superRefine(uniqueIds<AboutFact>("fact")),
};
const ctaShape = {
  visible: z.boolean(),
  primaryLabel: text(40),
  primaryHref: safeHref,
  secondaryLabel: text(40),
  secondaryHref: safeHref,
};
const aboutShape = {
  metaDescription: text(300),
  eyebrow: text(60),
  title: text(200),
  intro: text(1000),
};

/** Full schema used when saving from the admin editor. */
export const aboutSchema = z.object({
  ...aboutShape,
  facts: z.object(factsShape),
  sections: z
    .array(sectionSchema)
    .max(MAX_ABOUT_SECTIONS, `At most ${MAX_ABOUT_SECTIONS} sections`)
    .superRefine(uniqueIds<AboutSection>("section")),
  cta: z.object(ctaShape),
});

function pick(stored: unknown, key: string): unknown {
  return typeof stored === "object" && stored !== null
    ? (stored as Record<string, unknown>)[key]
    : undefined;
}

function dedupe<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
}

/** Merges stored About content over the defaults, validating every field. */
export function mergeAbout(stored: unknown): AboutContent {
  const d = DEFAULT_ABOUT;
  const base = mergeFields(aboutShape, {
    metaDescription: d.metaDescription,
    eyebrow: d.eyebrow,
    title: d.title,
    intro: d.intro,
  }, stored);
  const facts = mergeFields(factsShape, d.facts, pick(stored, "facts"));
  return {
    ...base,
    facts: {
      visible: facts.visible,
      items: dedupe(
        mergeList(factSchema, d.facts.items, pick(pick(stored, "facts"), "items"), {
          max: MAX_ABOUT_FACTS,
          emptyMeansDefault: false,
        }),
      ),
    },
    sections: dedupe(
      mergeList(sectionSchema, d.sections, pick(stored, "sections"), {
        max: MAX_ABOUT_SECTIONS,
        emptyMeansDefault: false,
      }),
    ),
    cta: mergeFields(ctaShape, d.cta, pick(stored, "cta")),
  };
}

/** Paragraphs of a section body (blank-line separated). */
export function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function newAboutFact(): AboutFact {
  return { id: newStableId("fact"), value: "", label: "" };
}

export function newAboutSection(): AboutSection {
  return { id: newStableId("section"), visible: true, heading: "", body: "" };
}
