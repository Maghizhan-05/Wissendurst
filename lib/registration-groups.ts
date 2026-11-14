/**
 * Splits confirmed registration rows into team registrations (one entry per
 * team of two or more, head first) and single registrations (0032). Pure, so
 * Admin Registrations and the export group identically.
 *
 * Registration units (D-022): aggregate registration figures count one solo
 * registration as 1 and one multi-member team as 1, using the SAME team
 * classification as groupRegistrations (isTeamUnitRow). Physical capacity,
 * rosters and exports stay per participant and don't use these helpers.
 */
export type UnitRow = {
  id: string;
  team_id: string | null;
  team?: { member_count: number } | null;
};

export type GroupableRow = UnitRow & {
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

/** A row that belongs to a team of two or more (counted with its team). */
export function isTeamUnitRow(r: UnitRow): boolean {
  return Boolean(r.team_id && r.team && r.team.member_count >= 2);
}

/** Identity of the registration unit a row belongs to: its team, or itself. */
export function registrationUnitKey(r: UnitRow): string {
  return isTeamUnitRow(r) ? `team:${r.team_id}` : `reg:${r.id}`;
}

/** Number of registration units (solo = 1, whole multi-member team = 1). */
export function countRegistrationUnits(rows: readonly UnitRow[]): number {
  return new Set(rows.map(registrationUnitKey)).size;
}

export function groupRegistrations<R extends GroupableRow>(
  rows: readonly R[],
): { teams: TeamGroup<R>[]; singles: R[] } {
  const byTeam = new Map<string, R[]>();
  const singles: R[] = [];
  for (const r of rows) {
    if (isTeamUnitRow(r)) {
      const teamId = r.team_id as string;
      const list = byTeam.get(teamId) ?? [];
      list.push(r);
      byTeam.set(teamId, list);
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
