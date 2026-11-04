import { cache } from "react";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_LANDING, mergeLanding, type LandingContent } from "@/lib/content/landing";
import { DEFAULT_ABOUT, mergeAbout, type AboutContent } from "@/lib/content/about";
import { EMPTY_APPEARANCE, mergeAppearance, type Appearance } from "@/lib/content/appearance";

/**
 * Reads the editable landing content, merged over built-in defaults. Resilient:
 * if the table isn't there yet or the query fails, returns the defaults so the
 * public site always renders.
 */
export async function getLandingContent(): Promise<LandingContent> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("site_settings")
      .select("content")
      .eq("id", 1)
      .maybeSingle();
    return mergeLanding(data?.content ?? null);
  } catch {
    return DEFAULT_LANDING;
  }
}

/** Editable About-page content merged over defaults (defaults on any error). */
export async function getAboutContent(): Promise<AboutContent> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("site_settings")
      .select("about")
      .eq("id", 1)
      .maybeSingle();
    if (error) return DEFAULT_ABOUT;
    return mergeAbout((data as { about?: unknown } | null)?.about ?? null);
  } catch {
    return DEFAULT_ABOUT;
  }
}

/**
 * Site colour overrides for the root layout. Uses a cookie-less public client
 * (site_settings is publicly readable) so it works for every route, and is
 * de-duplicated per request. Any failure → no overrides (design defaults).
 */
export const getAppearance = cache(async (): Promise<Appearance> => {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return EMPTY_APPEARANCE;
    const supabase = createAnonClient(url.trim(), key.trim(), {
      auth: { persistSession: false },
    });
    const { data, error } = await supabase
      .from("site_settings")
      .select("appearance")
      .eq("id", 1)
      .maybeSingle();
    if (error) return EMPTY_APPEARANCE;
    return mergeAppearance((data as { appearance?: unknown } | null)?.appearance ?? null);
  } catch {
    return EMPTY_APPEARANCE;
  }
});
