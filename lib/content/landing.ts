/**
 * Editable home-page content model. DEFAULT_LANDING is the built-in copy and
 * the fallback for any missing or invalid stored field (merge-over-default),
 * so partial or older saved JSON never breaks the page. Admins edit this at
 * /admin/content; pages read it via getLandingContent().
 */
import { z } from "zod";
import { mergeFields, mergeList } from "./merge.ts";
import { iconKey, newStableId, safeHref, stableId, text, type IconKey } from "./validation.ts";

export interface TitledBody {
  title: string;
  body: string;
}
export interface LabelValue {
  label: string;
  value: string;
}

/** One admin-managed homepage box (0–6, ordered). */
export interface HomeBox {
  id: string;
  enabled: boolean;
  icon: IconKey;
  title: string;
  description: string;
  linkLabel: string;
  href: string;
}

export const MAX_HOME_BOXES = 6;

export interface LandingContent {
  hero: {
    eyebrow: string;
    titleLine1: string;
    titleAccent: string;
    taglineLine1: string;
    taglineLine2: string;
    description: string;
    date: string;
    venue: string;
    ctaPrimary: string;
    ctaPrimaryHref: string;
    ctaSecondary: string;
    ctaSecondaryHref: string;
  };
  intro: {
    visible: boolean;
    index: string;
    eyebrow: string;
    title: string;
    paragraphs: string[];
  };
  /** The homepage boxes section (historically "categories"). */
  categories: {
    visible: boolean;
    index: string;
    eyebrow: string;
    title: string;
    description: string;
    boxes: HomeBox[];
  };
  featured: {
    visible: boolean;
    index: string;
    eyebrow: string;
    title: string;
    ctaLabel: string;
    ctaHref: string;
  };
  why: {
    visible: boolean;
    index: string;
    eyebrow: string;
    title: string;
    points: TitledBody[];
  };
  journey: {
    visible: boolean;
    index: string;
    eyebrow: string;
    title: string;
    steps: TitledBody[];
  };
  info: {
    visible: boolean;
    index: string;
    eyebrow: string;
    title: string;
    items: LabelValue[];
  };
  finalCta: {
    visible: boolean;
    title: string;
    description: string;
    ctaPrimary: string;
    ctaPrimaryHref: string;
    ctaSecondary: string;
    ctaSecondaryHref: string;
  };
  footer: {
    tagline: string;
    description: string;
    exploreHeading: string;
    contactHeading: string;
    contactName: string;
    contactEmail: string;
    dates: string;
    bottomNote: string;
  };
}

const DEFAULT_BOXES: HomeBox[] = [
  { id: "box-workshop", enabled: true, icon: "wrench", title: "Workshop", description: "Skills stations with real feedback.", linkLabel: "Browse", href: "/events?category=workshop" },
  { id: "box-debate", enabled: true, icon: "messages-square", title: "Debate", description: "Structured argument on live dilemmas.", linkLabel: "Browse", href: "/events?category=debate" },
  { id: "box-poster", enabled: true, icon: "presentation", title: "Poster Presentation", description: "Your research on one striking board.", linkLabel: "Browse", href: "/events?category=poster" },
  { id: "box-paper", enabled: true, icon: "file-text", title: "Paper Presentation", description: "Eight minutes to make your case.", linkLabel: "Browse", href: "/events?category=paper" },
  { id: "box-competition", enabled: true, icon: "trophy", title: "Competition", description: "Clinical reasoning, against the clock.", linkLabel: "Browse", href: "/events?category=competition" },
  { id: "box-academic", enabled: true, icon: "graduation-cap", title: "Academic Event", description: "Sessions that sharpen how you work.", linkLabel: "Browse", href: "/events?category=academic" },
];

export const DEFAULT_LANDING: LandingContent = {
  hero: {
    eyebrow: "Medical Symposium · College Event",
    titleLine1: "Wissendurst",
    titleAccent: "'27",
    taglineLine1: "Where medicine",
    taglineLine2: "meets curiosity.",
    description:
      "Three days of workshops, debates, and research presentations — built for students who ask the next question.",
    date: "Feb 12–14, 2027",
    venue: "Medical College Campus",
    ctaPrimary: "Register Now",
    ctaPrimaryHref: "/signup",
    ctaSecondary: "Explore Events",
    ctaSecondaryHref: "/events",
  },
  intro: {
    visible: true,
    index: "01",
    eyebrow: "Introduction",
    title: "A symposium for the clinically curious.",
    paragraphs: [
      "Wissendurst'27 gathers students across medicine and the allied sciences for three days of hands-on learning, sharp argument, and original research. It exists to give curiosity a stage — and a scoreboard.",
      "Whether you suture at a skills station, defend a bioethics motion, or present a case that changed how you think, this is where the work gets seen. Open to under- and post-graduate students from any institution.",
    ],
  },
  categories: {
    visible: true,
    index: "02",
    eyebrow: "Event Categories",
    title: "Six ways to take part.",
    description:
      "Every event routes into one of these tracks. Filter the full programme by category on the events page.",
    boxes: DEFAULT_BOXES,
  },
  featured: {
    visible: true,
    index: "03",
    eyebrow: "Featured Events",
    title: "Where to start.",
    ctaLabel: "All events",
    ctaHref: "/events",
  },
  why: {
    visible: true,
    index: "04",
    eyebrow: "Why Participate",
    title: "Six reasons this is worth your three days.",
    points: [
      { title: "Learn", body: "Hands-on stations and sessions taught by clinicians and researchers." },
      { title: "Compete", body: "Timed challenges that reward clear thinking under pressure." },
      { title: "Present", body: "Put original work in front of a panel that actually reads it." },
      { title: "Network", body: "Meet peers and faculty across institutions and specialties." },
      { title: "Collaborate", body: "Find the people your next project has been missing." },
      { title: "Build a record", body: "Certificates and results you can point to, verified by organizers." },
    ],
  },
  journey: {
    visible: true,
    index: "05",
    eyebrow: "The Experience",
    title: "From curious to confirmed, in five steps.",
    steps: [
      { title: "Discover", body: "Browse the programme and open any event." },
      { title: "Register", body: "Create an account, get your participant ID, pick events." },
      { title: "Pay", body: "Scan the UPI QR and upload your payment screenshot." },
      { title: "Verify", body: "We read the UTR, check for duplicates, and an organizer confirms." },
      { title: "Participate", body: "Show up, present, compete — you're on the list." },
    ],
  },
  info: {
    visible: true,
    index: "06",
    eyebrow: "Important Information",
    title: "The essentials, in one place.",
    items: [
      { label: "Dates", value: "February 12–14, 2027" },
      { label: "Venue", value: "Medical College Campus" },
      { label: "Registration deadline", value: "February 8, 2027" },
      { label: "Eligibility", value: "Under- & post-graduate students" },
      { label: "Contact", value: "hello@wissendurst.example" },
    ],
  },
  finalCta: {
    visible: true,
    title: "Ready to be part of Wissendurst'27?",
    description:
      "Create your account, claim your participant ID, and register in minutes.",
    ctaPrimary: "Register Now",
    ctaPrimaryHref: "/signup",
    ctaSecondary: "Explore Events",
    ctaSecondaryHref: "/events",
  },
  footer: {
    tagline: "Where Medicine Meets Curiosity",
    description:
      "A medical symposium of workshops, debates, and research presentations — built for the clinically curious.",
    exploreHeading: "Explore",
    contactHeading: "Contact",
    contactName: "Organizing Committee",
    contactEmail: "hello@wissendurst.example",
    dates: "Feb 12–14, 2027",
    bottomNote: "Built for the clinically curious.",
  },
};

/* ── Validation (save) ─────────────────────────────────────────────────── */

const titledBody = z.object({ title: text(120), body: text(400) });
const labelValue = z.object({ label: text(120), value: text(240) });

export const homeBoxSchema = z.object({
  id: stableId,
  enabled: z.boolean(),
  icon: iconKey,
  title: text(80).min(1, "Each box needs a title"),
  description: text(240),
  linkLabel: text(40).min(1, "Each box needs a link label"),
  href: safeHref,
});

const heroShape = {
  eyebrow: text(120),
  titleLine1: text(60),
  titleAccent: text(20),
  taglineLine1: text(80),
  taglineLine2: text(80),
  description: text(400),
  date: text(80),
  venue: text(120),
  ctaPrimary: text(40),
  ctaPrimaryHref: safeHref,
  ctaSecondary: text(40),
  ctaSecondaryHref: safeHref,
};
const introShape = {
  visible: z.boolean(),
  index: text(4),
  eyebrow: text(60),
  title: text(160),
  paragraphs: z.array(text(1000)).max(6),
};
const boxesSchema = z
  .array(homeBoxSchema)
  .max(MAX_HOME_BOXES, `At most ${MAX_HOME_BOXES} homepage boxes`)
  .superRefine((boxes, ctx) => {
    const seen = new Set<string>();
    boxes.forEach((b, i) => {
      if (seen.has(b.id))
        ctx.addIssue({ code: "custom", path: [i, "id"], message: "Duplicate box id" });
      seen.add(b.id);
    });
  });
const categoriesShape = {
  visible: z.boolean(),
  index: text(4),
  eyebrow: text(60),
  title: text(160),
  description: text(400),
  boxes: boxesSchema,
};
const featuredShape = {
  visible: z.boolean(),
  index: text(4),
  eyebrow: text(60),
  title: text(160),
  ctaLabel: text(40),
  ctaHref: safeHref,
};
const whyShape = {
  visible: z.boolean(),
  index: text(4),
  eyebrow: text(60),
  title: text(160),
  points: z.array(titledBody).max(9),
};
const journeyShape = {
  visible: z.boolean(),
  index: text(4),
  eyebrow: text(60),
  title: text(160),
  steps: z.array(titledBody).max(9),
};
const infoShape = {
  visible: z.boolean(),
  index: text(4),
  eyebrow: text(60),
  title: text(160),
  items: z.array(labelValue).max(10),
};
const finalCtaShape = {
  visible: z.boolean(),
  title: text(200),
  description: text(400),
  ctaPrimary: text(40),
  ctaPrimaryHref: safeHref,
  ctaSecondary: text(40),
  ctaSecondaryHref: safeHref,
};
const footerShape = {
  tagline: text(160),
  description: text(400),
  exploreHeading: text(40),
  contactHeading: text(40),
  contactName: text(120),
  contactEmail: text(160),
  dates: text(80),
  bottomNote: text(160),
};

/** Full schema used when saving from the admin editor. */
export const landingSchema = z.object({
  hero: z.object(heroShape),
  intro: z.object(introShape),
  categories: z.object(categoriesShape),
  featured: z.object(featuredShape),
  why: z.object(whyShape),
  journey: z.object(journeyShape),
  info: z.object(infoShape),
  finalCta: z.object(finalCtaShape),
  footer: z.object(footerShape),
});

/* ── Merge (read) ──────────────────────────────────────────────────────── */

function section(stored: unknown, key: string): unknown {
  return typeof stored === "object" && stored !== null
    ? (stored as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Merges stored content over the defaults, validating every field. Legacy
 * lists (paragraphs, reasons, steps, info items) fall back to defaults when
 * empty, as before; homepage boxes may legitimately be empty (0 boxes).
 */
export function mergeLanding(stored: unknown): LandingContent {
  const d = DEFAULT_LANDING;
  const s = (k: string) => section(stored, k);

  const intro = mergeFields(introShape, d.intro, s("intro"));
  const categories = mergeFields(categoriesShape, d.categories, s("categories"));
  const why = mergeFields(whyShape, d.why, s("why"));
  const journey = mergeFields(journeyShape, d.journey, s("journey"));
  const info = mergeFields(infoShape, d.info, s("info"));

  return {
    hero: mergeFields(heroShape, d.hero, s("hero")),
    intro: {
      ...intro,
      paragraphs: mergeList(text(1000), d.intro.paragraphs, section(s("intro"), "paragraphs"), { max: 6, emptyMeansDefault: true }),
    },
    categories: {
      ...categories,
      boxes: mergeBoxes(section(s("categories"), "boxes")),
    },
    featured: mergeFields(featuredShape, d.featured, s("featured")),
    why: {
      ...why,
      points: mergeList(titledBody, d.why.points, section(s("why"), "points"), { max: 9, emptyMeansDefault: true }),
    },
    journey: {
      ...journey,
      steps: mergeList(titledBody, d.journey.steps, section(s("journey"), "steps"), { max: 9, emptyMeansDefault: true }),
    },
    info: {
      ...info,
      items: mergeList(labelValue, d.info.items, section(s("info"), "items"), { max: 10, emptyMeansDefault: true }),
    },
    finalCta: mergeFields(finalCtaShape, d.finalCta, s("finalCta")),
    footer: mergeFields(footerShape, d.footer, s("footer")),
  };
}

/** Stored boxes: absent → defaults; present → valid, de-duplicated, ≤ 6. */
function mergeBoxes(stored: unknown): HomeBox[] {
  const boxes = mergeList(homeBoxSchema, DEFAULT_BOXES, stored, {
    max: MAX_HOME_BOXES,
    emptyMeansDefault: false,
  });
  const seen = new Set<string>();
  return boxes.filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));
}

/** A blank box for the editor. */
export function newHomeBox(): HomeBox {
  return {
    id: newStableId("box"),
    enabled: true,
    icon: "stethoscope",
    title: "",
    description: "",
    linkLabel: "Learn more",
    href: "/events",
  };
}
