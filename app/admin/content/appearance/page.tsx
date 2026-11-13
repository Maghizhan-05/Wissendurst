import type { Metadata } from "next";
import { AppearanceEditor } from "@/components/admin/appearance-editor";
import { BackgroundsEditor } from "@/components/admin/backgrounds-editor";
import { ContentNav } from "@/components/admin/content-nav";
import { getAppearance, getSiteBackgrounds } from "@/lib/data/settings";
import { requireScope } from "@/lib/auth";

export const metadata: Metadata = { title: "Admin · Appearance" };

export default async function AdminAppearancePage() {
  await requireScope("content");
  const [appearance, backgrounds] = await Promise.all([getAppearance(), getSiteBackgrounds()]);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ContentNav
        active="/admin/content/appearance"
        title="Site content"
        description="Background images, accent and theme colours for the whole site."
      />
      <BackgroundsEditor
        initial={backgrounds}
        supabaseUrl={(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim()}
      />
      <AppearanceEditor initial={appearance} />
    </div>
  );
}
