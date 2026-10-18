import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EventForm } from "@/components/admin/event-form";
import { createEvent } from "@/lib/actions/admin";
import { getTopLevelEventOptions } from "@/lib/data/admin";
import { requireScope } from "@/lib/auth";

export const metadata: Metadata = { title: "Admin · New event" };

export default async function NewEventPage({
  searchParams,
}: PageProps<"/admin/events/new">) {
  await requireScope("events");
  const sp = await searchParams;
  const defaultParentId = typeof sp.parent === "string" ? sp.parent : "";
  const parents = await getTopLevelEventOptions();
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/admin/events"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to events
      </Link>
      <h1 className="mt-4 font-display text-2xl font-semibold text-foreground">
        Create event
      </h1>
      <p className="mt-1 text-sm text-muted">
        The public event page is generated automatically from these fields.
      </p>
      <div className="mt-8">
        <EventForm
          action={createEvent}
          parents={parents}
          defaultParentId={defaultParentId}
        />
      </div>
    </div>
  );
}
