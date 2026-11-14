import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { canOpenAdmin, getProfile } from "@/lib/auth";
import { getLandingContent, getSocialSettings } from "@/lib/data/settings";
import { enabledSocialLinks } from "@/lib/content/social";
import {
  getGeneralRegistrationSettings,
  isGeneralRegistrationOpen,
} from "@/lib/data/general-registration";
import { canTakeGeneralRegistration } from "@/lib/general-registration";

export default async function PublicLayout({
  children,
}: LayoutProps<"/">) {
  const [profile, content, grSettings, social] = await Promise.all([
    getProfile(),
    getLandingContent(),
    getGeneralRegistrationSettings(),
    getSocialSettings(),
  ]);
  // Global admins and per-event administrators (0034) get the Admin link.
  const showAdmin = await canOpenAdmin(profile);
  const navUser = profile
    ? {
        participantId:
          profile.participant_id ??
          (profile.approval_status !== "approved" ? "Finish sign-up" : "Dashboard"),
        isAdmin: showAdmin,
        showGeneralRegistration:
          isGeneralRegistrationOpen(grSettings) &&
          canTakeGeneralRegistration(profile.participant_id, profile.approval_status),
      }
    : null;

  return (
    <>
      <Navbar user={navUser} socialLinks={enabledSocialLinks(social)} />
      <main className="flex-1">{children}</main>
      <Footer footer={content.footer} />
    </>
  );
}
