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
  TrendingUp,
  Ticket,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminScope, EventPermission } from "@/lib/constants";

type NavLink = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  scope?: AdminScope;
  /** Also shown to accounts with this permission on an assigned event (0034). */
  eventArea?: EventPermission;
  badge?: number;
  /** Visible only when the server says canViewAnalytics (requireAnalyticsAdmin identity). */
  analyticsOnly?: boolean;
};

export function AdminSidebar({
  scopes,
  isSuper,
  canViewAnalytics = false,
  eventAreas = { events: false, payments: false },
}: {
  scopes: AdminScope[];
  isSuper: boolean;
  /** Derived server-side by canViewAnalytics(access); never inferred from isSuper. */
  canViewAnalytics?: boolean;
  /** Global scope OR an event assignment grants the area (0034). */
  eventAreas?: Record<EventPermission, boolean>;
}) {
  const pathname = usePathname();

  const links: NavLink[] = [
    { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
    { href: "/admin/events", label: "Events", icon: CalendarCog, scope: "events", eventArea: "events" },
    { href: "/admin/registrations", label: "Registrations", icon: ClipboardList, scope: "events", eventArea: "events" },
    { href: "/admin/payments", label: "Payments", icon: BadgeIndianRupee, scope: "payments", eventArea: "payments" },
    { href: "/admin/general-registration", label: "General Registration", icon: Ticket, scope: "payments" },
    { href: "/admin/collections", label: "Collections", icon: TrendingUp, scope: "payments" },
    { href: "/admin/users", label: "Users", icon: Users, scope: "signups" },
    { href: "/admin/content", label: "Site content", icon: LayoutTemplate, scope: "content" },
    // D-026: analytics — only the single analytics admin (server-derived flag).
    { href: "/admin/analytics", label: "Analytics", icon: BarChart3, analyticsOnly: true },
  ];

  const visible = links.filter(
    (l) =>
      (l.analyticsOnly ? canViewAnalytics === true : true) &&
      (!l.scope ||
        isSuper ||
        scopes.includes(l.scope) ||
        (l.eventArea !== undefined && eventAreas[l.eventArea])),
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
