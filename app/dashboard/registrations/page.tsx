import type { Metadata } from "next";
import { Ticket } from "lucide-react";
import { RegistrationFlipCard } from "@/components/dashboard/registration-flip-card";
import { EmptyState } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { getMyRegistrations } from "@/lib/data/registrations";

export const metadata: Metadata = { title: "My Events" };

export default async function RegistrationsPage() {
  const registrations = await getMyRegistrations();

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">
            My events
          </h1>
          <p className="mt-1 text-sm text-muted">
            Hover or tap a card to see registration and payment details.
          </p>
        </div>
        <ButtonLink href="/events" variant="outline" size="sm" withArrow>
          Add more
        </ButtonLink>
      </div>

      {registrations.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<Ticket className="size-8" />}
            title="No registrations yet"
            description="Events appear here once your spot is confirmed — free events straight away, paid events after your payment is verified."
            action={
              <ButtonLink href="/events" withArrow>
                Explore Events
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {registrations.map((r) => (
            <RegistrationFlipCard key={r.id} registration={r} />
          ))}
        </div>
      )}
    </div>
  );
}
