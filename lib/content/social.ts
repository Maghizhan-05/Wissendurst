import { z } from "zod";

/**
 * Social links shown in the navbar menu (0030, site_settings.social).
 * Mirrors public.site_social_links_error: at most five links, allowlisted
 * platforms, https only, and each platform's link must be on its own site.
 */

export const MAX_SOCIAL_LINKS = 5;

export const SOCIAL_PLATFORMS = [
  "instagram",
  "facebook",
  "x",
  "youtube",
  "linkedin",
  "whatsapp",
  "telegram",
  "threads",
  "website",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X (Twitter)",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  threads: "Threads",
  website: "Website",
};

const PLATFORM_HOSTS: Record<Exclude<SocialPlatform, "website">, readonly string[]> = {
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.com", "m.facebook.com"],
  x: ["x.com", "twitter.com"],
  youtube: ["youtube.com", "youtu.be", "m.youtube.com"],
  linkedin: ["linkedin.com"],
  whatsapp: ["wa.me", "whatsapp.com", "chat.whatsapp.com"],
  telegram: ["t.me", "telegram.me"],
  threads: ["threads.net", "threads.com"],
};

const HOST_HINT: Record<Exclude<SocialPlatform, "website">, string> = {
  instagram: "instagram.com",
  facebook: "facebook.com",
  x: "x.com or twitter.com",
  youtube: "youtube.com or youtu.be",
  linkedin: "linkedin.com",
  whatsapp: "wa.me or whatsapp.com",
  telegram: "t.me",
  threads: "threads.net",
};

export type SocialLink = { platform: SocialPlatform; url: string; enabled: boolean };
export type SocialSettings = { links: SocialLink[] };

export const EMPTY_SOCIAL: SocialSettings = { links: [] };

// Same shape as the database check (^https://host(:port)?(/no-space-or-<>"'`)?$).
const URL_PATTERN = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?(\/[^\s<>"'`]*)?$/;

/** Why a link isn't acceptable, or null when it is. */
export function socialLinkError(platform: SocialPlatform, url: string): string | null {
  const v = url.trim();
  if (!v) return "Enter the link";
  if (v.length > 300) return "Links can be at most 300 characters";
  if (/^http:\/\//i.test(v)) return "Use a secure link that starts with https://";
  if (!URL_PATTERN.test(v)) return "Enter a full https:// web address";
  const host = v.slice("https://".length).split(/[/:]/)[0].toLowerCase().replace(/^www\./, "");
  if (platform === "website") {
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? null : "Enter a full https:// web address";
  }
  if (!PLATFORM_HOSTS[platform].includes(host))
    return `${SOCIAL_LABELS[platform]} links must be on ${HOST_HINT[platform]}`;
  return null;
}

export const socialSchema = z
  .object({
    links: z
      .array(
        z.object({
          platform: z.enum(SOCIAL_PLATFORMS),
          url: z.string().trim(),
          enabled: z.boolean(),
        }),
      )
      .max(MAX_SOCIAL_LINKS, `At most ${MAX_SOCIAL_LINKS} social links`),
  })
  .strict()
  .superRefine((value, ctx) => {
    value.links.forEach((l, i) => {
      const err = socialLinkError(l.platform, l.url);
      if (err) ctx.addIssue({ code: "custom", path: ["links", i, "url"], message: err });
    });
  });

/** Stored value → settings; anything malformed is dropped (never shown). */
export function mergeSocial(raw: unknown): SocialSettings {
  const parsed = socialSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_SOCIAL;
}

/** Links the navbar shows, in order. */
export function enabledSocialLinks(s: SocialSettings): SocialLink[] {
  return s.links.filter((l) => l.enabled && socialLinkError(l.platform, l.url) === null);
}
