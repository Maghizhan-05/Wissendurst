import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import { siteUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Cookie-less anon client for public reads at request time. */
async function eventSlugs(): Promise<string[]> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return [];
    const supabase = createClient(url, key, {
      auth: { persistSession: false },
    });
    const { data } = await supabase
      .from("events")
      .select("slug")
      .is("archived_at", null);
    return (data ?? []).map((r) => (r as { slug: string }).slug);
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes = [
    "",
    "/events",
    "/about",
    "/schedule",
    "/signup",
    "/login",
  ];
  const slugs = await eventSlugs();

  return [
    ...staticRoutes.map((path) => ({
      url: siteUrl(path),
      lastModified: new Date(),
    })),
    ...slugs.map((slug) => ({
      url: siteUrl(`/events/${slug}`),
      lastModified: new Date(),
    })),
  ];
}
