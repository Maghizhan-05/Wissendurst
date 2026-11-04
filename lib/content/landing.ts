/**
 * Editable landing-page content model. The DEFAULT_LANDING below is the
 * current copy and acts as the fallback whenever a field is missing from the
 * database (so partial edits never break the page). Admins edit this at
 * /admin/content; the landing page reads it via getLandingContent().
 */

export interface TitledBody {
  title: string;
  body: string;
}
export interface LabelValue {
  label: string;
  value: string;
}

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
    ctaSecondary: string;
  };
  intro: {
    index: string;
    eyebrow: string;
    title: string;
    paragraphs: string[];
  };
  categories: {
    index: string;
    eyebrow: string;
    title: string;
    description: string;
  };
  featured: {
    index: string;
    eyebrow: string;
    title: string;
  };
  why: {
    index: string;
    eyebrow: string;
    title: string;
    points: TitledBody[];
  };
  journey: {
    index: string;
    eyebrow: string;
    title: string;
    steps: TitledBody[];
  };
  info: {
    index: string;
    eyebrow: string;
    title: string;
    items: LabelValue[];
  };
  finalCta: {
    title: string;
    description: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  footer: {
    tagline: string;
    contactEmail: string;
    dates: string;
  };
}

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
    ctaSecondary: "Explore Events",
  },
  intro: {
    index: "01",
    eyebrow: "Introduction",
    title: "A symposium for the clinically curious.",
    paragraphs: [
      "Wissendurst'27 gathers students across medicine and the allied sciences for three days of hands-on learning, sharp argument, and original research. It exists to give curiosity a stage — and a scoreboard.",
      "Whether you suture at a skills station, defend a bioethics motion, or present a case that changed how you think, this is where the work gets seen. Open to under- and post-graduate students from any institution.",
    ],
  },
  categories: {
    index: "02",
    eyebrow: "Event Categories",
    title: "Six ways to take part.",
    description:
      "Every event routes into one of these tracks. Filter the full programme by category on the events page.",
  },
  featured: {
    index: "03",
    eyebrow: "Featured Events",
    title: "Where to start.",
  },
  why: {
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
    title: "Ready to be part of Wissendurst'27?",
    description:
      "Create your account, claim your participant ID, and register in minutes.",
    ctaPrimary: "Register Now",
    ctaSecondary: "Explore Events",
  },
  footer: {
    tagline: "Where Medicine Meets Curiosity",
    contactEmail: "hello@wissendurst.example",
    dates: "Feb 12–14, 2027",
  },
};

/** Deep-merges stored content over defaults so partial data never breaks UI. */
export function mergeLanding(
  stored: Partial<LandingContent> | null | undefined,
): LandingContent {
  if (!stored) return DEFAULT_LANDING;
  const d = DEFAULT_LANDING;
  const s = stored;
  return {
    hero: { ...d.hero, ...s.hero },
    intro: {
      ...d.intro,
      ...s.intro,
      paragraphs: s.intro?.paragraphs?.length ? s.intro.paragraphs : d.intro.paragraphs,
    },
    categories: { ...d.categories, ...s.categories },
    featured: { ...d.featured, ...s.featured },
    why: {
      ...d.why,
      ...s.why,
      points: s.why?.points?.length ? s.why.points : d.why.points,
    },
    journey: {
      ...d.journey,
      ...s.journey,
      steps: s.journey?.steps?.length ? s.journey.steps : d.journey.steps,
    },
    info: {
      ...d.info,
      ...s.info,
      items: s.info?.items?.length ? s.info.items : d.info.items,
    },
    finalCta: { ...d.finalCta, ...s.finalCta },
    footer: { ...d.footer, ...s.footer },
  };
}
