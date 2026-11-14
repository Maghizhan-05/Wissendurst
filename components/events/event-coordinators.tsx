import { Mail, Phone, UsersRound } from "lucide-react";
import { mailHref, normalizeStoredCoordinators, telHref } from "@/lib/events/coordinators";

/**
 * Public coordinator contact cards (0035 / D-023). Renders nothing when the
 * event has none. Only validated entries are shown; links are tel:/mailto:
 * built from validated values.
 */
export function EventCoordinators({ coordinators }: { coordinators: unknown }) {
  const list = normalizeStoredCoordinators(coordinators);
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="coordinators-heading">
      <h2
        id="coordinators-heading"
        className="flex items-center gap-2 font-display text-2xl font-semibold text-foreground"
      >
        <UsersRound className="size-5 text-brand" aria-hidden /> Coordinators
      </h2>
      <p className="mt-2 text-sm text-muted">Questions about this event? Reach the organisers directly.</p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {list.map((c, i) => (
          <li key={i} className="flex min-w-0 flex-col rounded-2xl border border-border bg-surface p-4">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/12 font-display text-sm font-semibold text-brand"
              >
                {initials(c.name)}
              </span>
              <div className="min-w-0">
                <p className="break-words font-medium text-foreground">{c.name}</p>
                {c.role && <p className="break-words text-xs text-muted">{c.role}</p>}
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
              {c.phone && (
                <a
                  href={telHref(c.phone)}
                  className="inline-flex min-h-9 min-w-0 items-center gap-2 rounded-lg px-1 text-foreground hover:text-brand"
                  aria-label={`Call ${c.name} at ${c.phone}`}
                >
                  <Phone className="size-4 shrink-0 text-brand" aria-hidden />
                  <span className="truncate">{c.phone}</span>
                </a>
              )}
              {c.email && (
                <a
                  href={mailHref(c.email)}
                  className="inline-flex min-h-9 min-w-0 items-center gap-2 rounded-lg px-1 text-foreground hover:text-brand"
                  aria-label={`Email ${c.name} at ${c.email}`}
                >
                  <Mail className="size-4 shrink-0 text-brand" aria-hidden />
                  <span className="truncate">{c.email}</span>
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function initials(name: string): string {
  const parts = name.replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}
