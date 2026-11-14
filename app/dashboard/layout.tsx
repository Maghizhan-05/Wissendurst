import Link from "next/link";
import { LogOut, Shield } from "lucide-react";
import { Container } from "@/components/ui/container";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { canOpenAdmin, requireProfile } from "@/lib/auth";
import { signOut } from "@/lib/actions/auth";
import { SITE } from "@/lib/constants";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const profile = await requireProfile();
  // Global admins and per-event administrators (0034).
  const showAdmin = await canOpenAdmin(profile);

  return (
    <div className="min-h-svh">
      <header className="border-b border-border bg-surface/60 backdrop-blur">
        <Container className="flex h-16 items-center justify-between">
          <Link
            href="/"
            className="font-display text-lg font-semibold text-foreground"
          >
            {SITE.name}
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {showAdmin && (
              <Link
                href="/admin"
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
              >
                <Shield className="size-4" /> Admin
              </Link>
            )}
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm">
                <LogOut className="size-4" /> Sign out
              </Button>
            </form>
          </div>
        </Container>
      </header>

      <Container className="py-8">
        <DashboardNav />
        <div className="pt-8">{children}</div>
      </Container>
    </div>
  );
}
