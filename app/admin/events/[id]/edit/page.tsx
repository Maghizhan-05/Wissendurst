import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Sheet } from "lucide-react";
import { EventForm } from "@/components/admin/event-form";
import { updateEvent } from "@/lib/actions/admin";
import { getEventByIdAdmin, getTopLevelEventOptions } from "@/lib/data/admin";
import { getSubEvents } from "@/lib/data/events";
import { requireScope } from "@/lib/auth";

export const metadata: Metadata = { title: "Admin · Edit event" };

export default async function EditEventPage({
  params,
}: PageProps<"/admin/events/[id]/edit">) {
  await requireScope("events");
  const { id } = await params;
  const event = await getEventByIdAdmin(id);
  if (!event) notFound();

  const [parents, children] = await Promise.all([
    getTopLevelEventOptions(id),
    getSubEvents(id),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/admin/events"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to events
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Edit event
          </h1>
          <p className="mt-1 text-sm text-muted">{event.title}</p>
        </div>
        <a
          href={`/admin/events/${event.id}/export`}
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
        >
          <Sheet className="size-4 text-success" /> Export participants
        </a>
      </div>
      <div className="mt-8">
        <EventForm
          action={updateEvent}
          event={event}
          parents={parents}
          hasChildren={children.length > 0}
        />
      </div>
    </div>
  );
}
