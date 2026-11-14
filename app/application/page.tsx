import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResubmitApplicationForm } from "@/components/auth/resubmit-application-form";
import { signOut } from "@/lib/actions/auth";
import { getProfile, isBanned } from "@/lib/auth";
import { SITE } from "@/lib/constants";

export const metadata: Metadata = { title: "Finish your profile" };

/**
 * The only signed-in page an inactive profile can use: finish sign-up on the
 * same account — details plus a college ID card. Approval-free (0035): saving
 * activates the profile and issues the participant ID at once.
 */
export default async function ApplicationPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login?next=/application");
  if (await isBanned(profile.id)) redirect("/blocked");
  if (profile.approval_status === "approved") redirect("/dashboard");

  return (
    <div className="min-h-svh px-5 py-12">
      <div className="mx-auto w-full max-w-lg">
        <Link href="/" className="font-display text-lg font-semibold text-foreground">
          {SITE.name}
        </Link>
        <h1 className="mt-8 font-display text-3xl font-semibold text-foreground">Finish your profile</h1>
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm">
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <p className="text-muted">
            <span className="font-medium text-foreground">Your sign-up isn&rsquo;t finished yet.</span> Check
            your details and upload a photo of your college ID card. You keep this same account and get your
            participant ID as soon as you save.
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
