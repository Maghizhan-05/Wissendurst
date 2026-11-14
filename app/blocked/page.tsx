import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/actions/auth";
import { getProfile, isBanned } from "@/lib/auth";
import { SITE } from "@/lib/constants";

export const metadata: Metadata = { title: "Account suspended" };

/**
 * Explicit blocked state for a banned account (0035). Nothing about the
 * account is deleted; registrations, payments and the participant ID stay as
 * evidence. Unbanning restores access with the same identity.
 */
export default async function BlockedPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!(await isBanned(profile.id))) redirect("/dashboard");

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center px-5 text-center">
      <div className="relative max-w-md">
        <Link href="/" className="font-display text-lg font-semibold text-foreground">
          {SITE.name}
        </Link>
        <div className="mx-auto mt-8 flex size-16 items-center justify-center rounded-full bg-alert/15 text-alert">
          <ShieldOff className="size-7" aria-hidden />
        </div>
        <h1 className="mt-6 font-display text-3xl font-semibold text-foreground sm:text-4xl">
          Your account is suspended
        </h1>
        <p className="mt-3 text-muted">
          An organizer has suspended this account, so you can&rsquo;t register for events, submit
          payments or change your profile right now. Your existing records are kept. If you think
          this is a mistake, contact the organizers.
        </p>
        {profile.participant_id && (
          <p className="mt-4 text-sm text-muted">
            Participant ID <span className="font-mono text-brand">{profile.participant_id}</span>
          </p>
        )}
        <form action={signOut} className="mt-8">
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}
