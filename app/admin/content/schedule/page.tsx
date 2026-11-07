import type { Metadata } from "next";
import { ContentNav } from "@/components/admin/content-nav";
import { ScheduleEditor } from "@/components/admin/schedule-editor";
import { getScheduleContent } from "@/lib/data/settings";
import { requireScope } from "@/lib/auth";

export const metadata: Metadata = { title: "Admin · Schedule page" };

export default async function AdminSchedulePage() {
  await requireScope("content");
  const schedule = await getScheduleContent();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ContentNav
        active="/admin/content/schedule"
        title="Site content"
        description="Wording on the public Schedule page. Event titles, dates, times, venues and categories come from the events themselves."
      />
      <ScheduleEditor initial={schedule} />
    </div>
  );
}
