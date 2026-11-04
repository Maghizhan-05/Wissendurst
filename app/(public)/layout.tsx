import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { getProfile } from "@/lib/auth";
import { getLandingContent } from "@/lib/data/settings";
import {
  getGeneralRegistrationSettings,
  isGeneralRegistrationOpen,
} from "@/lib/data/general-registration";
import { canTakeGeneralRegistration } from "@/lib/general-registration";

export default async function PublicLayout({
  children,
}: LayoutProps<"/">) {
  const [profile, content, grSettings] = await Promise.all([
    getProfile(),
    getLandingContent(),
    getGeneralRegistrationSettings(),
  ]);
  const navUser = profile
    ? {
        participantId: profile.participant_id ?? "",
        isAdmin: profile.role === "admin",
        showGeneralRegistration:
          isGeneralRegistrationOpen(grSettings) &&
          canTakeGeneralRegistration(profile.participant_id, profile.approval_status),
      }
    : null;

  return (
    <>
      <Navbar user={navUser} />
      <main className="flex-1">{children}</main>
      <Footer footer={content.footer} />
    </>
  );
}
