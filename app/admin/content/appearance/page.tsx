import type { Metadata } from "next";
import { AppearanceEditor } from "@/components/admin/appearance-editor";
import { ContentNav } from "@/components/admin/content-nav";
import { getAppearance } from "@/lib/data/settings";
import { requireScope } from "@/lib/auth";

export const metadata: Metadata = { title: "Admin · Appearance" };

export default async function AdminAppearancePage() {
  await requireScope("content");
  const appearance = await getAppearance();
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ContentNav
        active="/admin/content/appearance"
        title="Site content"
        description="Light and dark theme colours for the whole site."
      />
      <AppearanceEditor initial={appearance} />
    </div>
  );
}
