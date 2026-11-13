/**
 * Splits confirmed registration rows into team registrations (one entry per
 * team of two or more, head first) and single registrations (0032). Pure, so
 * Admin Registrations and the export group identically.
 */
export type GroupableRow = {
  id: string;
  team_id: string | null;
  is_team_head: boolean;
  registered_at: string;
  team?: { name: string | null; member_count: number; code: string | null } | null;
  profile: { full_name: string | null } | null;
};

export type TeamGroup<R extends GroupableRow> = {
  teamId: string;
  code: string | null;
  name: string | null;
  head: R;
  members: R[]; // head first, then by name
};

export function groupRegistrations<R extends GroupableRow>(
  rows: readonly R[],
): { teams: TeamGroup<R>[]; singles: R[] } {
  const byTeam = new Map<string, R[]>();
  const singles: R[] = [];
  for (const r of rows) {
    if (r.team_id && r.team && r.team.member_count >= 2) {
      const list = byTeam.get(r.team_id) ?? [];
      list.push(r);
      byTeam.set(r.team_id, list);
    } else {
      singles.push(r);
    }
  }
  const teams: TeamGroup<R>[] = [];
  for (const [teamId, list] of byTeam) {
    const members = [...list].sort(
      (a, b) =>
        Number(b.is_team_head) - Number(a.is_team_head) ||
        (a.profile?.full_name ?? "").localeCompare(b.profile?.full_name ?? "", "en"),
    );
    const head = members[0];
    teams.push({ teamId, code: head.team?.code ?? null, name: head.team?.name ?? null, head, members });
  }
  // Newest first, like the flat list was.
  teams.sort((a, b) => b.head.registered_at.localeCompare(a.head.registered_at));
  return { teams, singles };
}
