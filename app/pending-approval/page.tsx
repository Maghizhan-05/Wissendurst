import type { Metadata } from "next";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button";
import { signOut } from "@/lib/actions/auth";
import { getProfile } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Awaiting approval" };

export default async function PendingApprovalPage() {
  const profile = await getProfile();
  // Approved users don't belong here.
  if (profile?.approval_status === "approved") redirect("/dashboard");

  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-5 text-center">
      <div className="brand-glow pointer-events-none absolute inset-x-0 top-0 h-96" />
      <div className="relative">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-warning/15 text-warning">
          <Clock className="size-7" />
        </div>
        <h1 className="mt-6 font-display text-3xl font-semibold text-foreground sm:text-4xl">
          {profile?.approval_status === "rejected"
            ? "Account not approved"
            : "Awaiting approval"}
        </h1>
        <p className="mt-3 max-w-md text-muted">
          {profile?.approval_status === "rejected"
            ? "Your account could not be approved. Please contact the organizers if you think this is a mistake."
            : "Your account and ID card are with an organizer for review. You'll get an email the moment you're approved — then you can sign in and register."}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/events" variant="outline" withArrow>
            Browse events
          </ButtonLink>
          <form action={signOut}>
            <Button type="submit" variant="ghost">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
