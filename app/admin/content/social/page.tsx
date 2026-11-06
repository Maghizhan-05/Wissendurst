import type { Metadata } from "next";
import { ContentNav } from "@/components/admin/content-nav";
import { SocialLinksEditor } from "@/components/admin/social-links-editor";
import { getSocialSettings } from "@/lib/data/settings";
import { requireScope } from "@/lib/auth";

export const metadata: Metadata = { title: "Admin · Social links" };

export default async function AdminSocialLinksPage() {
  await requireScope("content");
  const social = await getSocialSettings();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ContentNav
        active="/admin/content/social"
        title="Site content"
        description="Up to five social links, shown in a menu beside the light/dark switch."
      />
      <SocialLinksEditor initial={social} />
    </div>
  );
}
