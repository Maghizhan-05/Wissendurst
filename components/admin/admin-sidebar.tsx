"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarCog,
  Users,
  ClipboardList,
  BadgeIndianRupee,
  LayoutTemplate,
  UserCheck,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminScope } from "@/lib/constants";

type NavLink = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  scope?: AdminScope;
  badge?: number;
};

export function AdminSidebar({
  scopes,
  isSuper,
  pendingCount = 0,
}: {
  scopes: AdminScope[];
  isSuper: boolean;
  pendingCount?: number;
}) {
  const pathname = usePathname();

  const links: NavLink[] = [
    { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
    { href: "/admin/approvals", label: "Approvals", icon: UserCheck, scope: "signups", badge: pendingCount },
    { href: "/admin/events", label: "Events", icon: CalendarCog, scope: "events" },
    { href: "/admin/registrations", label: "Registrations", icon: ClipboardList, scope: "events" },
    { href: "/admin/payments", label: "Payments", icon: BadgeIndianRupee, scope: "payments" },
    { href: "/admin/collections", label: "Collections", icon: TrendingUp, scope: "payments" },
    { href: "/admin/users", label: "Users", icon: Users, scope: "signups" },
    { href: "/admin/content", label: "Landing page", icon: LayoutTemplate, scope: "content" },
  ];

  const visible = links.filter(
    (l) => !l.scope || isSuper || scopes.includes(l.scope),
  );

  return (
    <nav className="flex gap-1 overflow-x-auto p-2 md:flex-col md:gap-0.5 md:p-3">
      {visible.map((l) => {
        const active = l.exact
          ? pathname === l.href
          : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-brand/12 text-brand"
                : "text-muted hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <l.icon className="size-4" />
            <span className="flex-1">{l.label}</span>
            {l.badge ? (
              <span className="rounded-full bg-alert px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {l.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
