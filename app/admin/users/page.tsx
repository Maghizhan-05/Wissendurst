import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { getUsersAdmin } from "@/lib/data/admin";
import { requireScope } from "@/lib/auth";

export const metadata: Metadata = { title: "Admin · Users" };

export default async function AdminUsersPage({
  searchParams,
}: PageProps<"/admin/users">) {
  await requireScope("signups");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const users = await getUsersAdmin(q);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Users
        </h1>
        <p className="mt-1 text-sm text-muted">{users.length} shown</p>
      </div>

      <form method="get" className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name, email, or participant ID…"
          className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3 text-sm text-foreground"
        />
      </form>

      {users.length === 0 ? (
        <EmptyState title="No users found" description="Try a different search." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border bg-surface-2/50 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Participant</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">College</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id} className="bg-surface hover:bg-surface-2/40">
                  <td className="px-4 py-3 font-mono text-xs text-brand">
                    {u.participant_id ?? (
                      <span className="text-muted">Pending approval</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{u.full_name || "—"}</p>
                    <p className="text-xs text-muted">{u.email}</p>
                  </td>
                  <td className="px-4 py-3 text-muted">{u.college ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={u.role === "admin" ? "brand" : "neutral"}>
                      {u.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
