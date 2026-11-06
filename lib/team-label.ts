/** Shown wherever a team has no name (registered before team names, 0030). */
export const UNNAMED_TEAM = "Unnamed team";

export function teamLabel(name: string | null | undefined): string {
  return name && name.trim() ? name : UNNAMED_TEAM;
}

/**
 * How a registration's team reads in lists: null when not a real team (no
 * team, or a team of one), otherwise the name or "Unnamed team".
 */
export function teamDisplay(
  team: { name: string | null; member_count?: number | null } | null | undefined,
): string | null {
  if (!team) return null;
  if (team.member_count != null && team.member_count <= 1) return null;
  return teamLabel(team.name);
}
