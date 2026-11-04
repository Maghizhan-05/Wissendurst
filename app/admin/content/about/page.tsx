import type { Metadata } from "next";
import { AboutEditor } from "@/components/admin/about-editor";
import { ContentNav } from "@/components/admin/content-nav";
import { getAboutContent } from "@/lib/data/settings";
import { requireScope } from "@/lib/auth";

export const metadata: Metadata = { title: "Admin · About page" };

export default async function AdminAboutContentPage() {
  await requireScope("content");
  const about = await getAboutContent();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ContentNav
        active="/admin/content/about"
        title="Site content"
        description="Everything on the public About page: header, facts, sections and buttons."
      />
      <AboutEditor initial={about} />
    </div>
  );
}
