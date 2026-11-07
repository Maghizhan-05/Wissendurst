import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResubmitApplicationForm } from "@/components/auth/resubmit-application-form";
import { signOut } from "@/lib/actions/auth";
import { getProfile } from "@/lib/auth";
import { SITE } from "@/lib/constants";

export const metadata: Metadata = { title: "Correct your application" };

/**
 * The only signed-in page a rejected applicant can use: correct the same
 * application and upload a new ID card (0031). Everyone else is sent on.
 */
export default async function ApplicationPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login?next=/application");
  if (profile.approval_status === "approved") redirect("/dashboard");
  if (profile.approval_status === "pending") redirect("/pending-approval");

  return (
    <div className="min-h-svh px-5 py-12">
      <div className="mx-auto w-full max-w-lg">
        <Link href="/" className="font-display text-lg font-semibold text-foreground">
          {SITE.name}
        </Link>
        <h1 className="mt-8 font-display text-3xl font-semibold text-foreground">Correct your application</h1>
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm">
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <p className="text-muted">
            <span className="font-medium text-foreground">Your sign-up wasn&rsquo;t approved.</span> Check your
            details, upload a new photo of your college ID card and resubmit — an organizer will review it again.
            You keep this same account; you&rsquo;ll get a participant ID when you&rsquo;re approved.
          </p>
        </div>
        <div className="mt-8 rounded-2xl border border-border bg-surface p-6">
          <ResubmitApplicationForm profile={profile} />
        </div>
        <form action={signOut} className="mt-6 text-center">
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}
