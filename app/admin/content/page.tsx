import type { Metadata } from "next";
import { LandingEditor } from "@/components/admin/landing-editor";
import { ContentNav } from "@/components/admin/content-nav";
import { getLandingContent } from "@/lib/data/settings";
import { requireScope } from "@/lib/auth";

export const metadata: Metadata = { title: "Admin · Home page" };

export default async function AdminContentPage() {
  await requireScope("content");
  const content = await getLandingContent();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ContentNav
        active="/admin/content"
        title="Site content"
        description="Edit everything on the public home page — no developer needed."
      />
      <LandingEditor initial={content} />
    </div>
  );
}
