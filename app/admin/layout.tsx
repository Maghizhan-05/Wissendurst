import Link from "next/link";
import { ArrowUpRight, LogOut } from "lucide-react";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { hasAreaAccess, requireAdminAccess } from "@/lib/auth";
import { signOut } from "@/lib/actions/auth";
import { countPendingSignups } from "@/lib/data/admin";
import { SITE } from "@/lib/constants";

export default async function AdminLayout({ children }: LayoutProps<"/">) {
  // Global admins, plus accounts holding per-event assignments (0034).
  const access = await requireAdminAccess();
  const { profile } = access;
  const pending =
    access.isSuper || access.scopes.includes("signups")
      ? await countPendingSignups()
      : 0;

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur">
        <div className="flex h-14 items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="font-display text-base font-semibold text-foreground">
              {SITE.name}
            </Link>
            <span className="rounded-md bg-brand/12 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-brand">
              Admin
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="hidden items-center gap-1 text-sm text-muted hover:text-foreground sm:inline-flex"
            >
              View site <ArrowUpRight className="size-3.5" />
            </Link>
            <ThemeToggle />
            <span className="hidden text-sm text-muted sm:inline">
              {profile.full_name || profile.email}
            </span>
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm">
                <LogOut className="size-4" />
              </Button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px] flex-col md:flex-row">
        <aside className="border-b border-border md:w-56 md:shrink-0 md:border-b-0 md:border-r">
          <div className="md:sticky md:top-14">
            <AdminSidebar
              scopes={access.scopes}
              isSuper={access.isSuper}
              eventAreas={{
                events: hasAreaAccess(access, "events"),
                payments: hasAreaAccess(access, "payments"),
              }}
              pendingCount={pending}
            />
          </div>
        </aside>
        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
