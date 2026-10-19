import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { getProfile } from "@/lib/auth";
import { getLandingContent } from "@/lib/data/settings";

export default async function PublicLayout({
  children,
}: LayoutProps<"/">) {
  const [profile, content] = await Promise.all([
    getProfile(),
    getLandingContent(),
  ]);
  const navUser = profile
    ? {
        participantId: profile.participant_id ?? "",
        isAdmin: profile.role === "admin",
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
