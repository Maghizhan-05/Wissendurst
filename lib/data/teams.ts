import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { queryError } from "@/lib/supabase/query-error";
import type { RegistrationRow } from "@/types/database";

export { UNNAMED_TEAM, teamLabel } from "@/lib/team-label";

export type TeamMemberView = {
  id: string; // profile id
  participant_id: string;
  full_name: string;
  email: string;
  college: string | null;
  is_head: boolean;
};

export type TeamView = { id: string; name: string | null; members: TeamMemberView[] };

/**
 * The team of a registration the caller has ALREADY read through RLS (their
 * own row). Teammates' basic details come from the service role, as the
 * team form's teammate lookup does. Head first, then by name.
 */
export async function getTeamForRegistration(
  reg: Pick<RegistrationRow, "team_id">,
): Promise<TeamView | null> {
  if (!reg.team_id) return null;
  const admin = createAdminClient();
  const [{ data: team, error: teamErr }, { data: rows, error: rowsErr }] = await Promise.all([
    admin.from("teams").select("id, name").eq("id", reg.team_id).maybeSingle(),
    admin
      .from("registrations")
      .select("is_team_head, profile:profiles!profile_id(id, participant_id, full_name, email, college)")
      .eq("team_id", reg.team_id),
  ]);
  if (teamErr) throw queryError("teams", teamErr);
  if (rowsErr) throw queryError("team members", rowsErr);
  if (!team) return null;
  type Row = {
    is_team_head: boolean;
    profile: { id: string; participant_id: string | null; full_name: string; email: string; college: string | null } | null;
  };
  const members = ((rows ?? []) as unknown as Row[])
    .filter((r) => r.profile)
    .map((r) => ({
      id: r.profile!.id,
      participant_id: r.profile!.participant_id ?? "",
      full_name: r.profile!.full_name,
      email: r.profile!.email,
      college: r.profile!.college,
      is_head: r.is_team_head,
    }))
    .sort((a, b) => Number(b.is_head) - Number(a.is_head) || a.full_name.localeCompare(b.full_name, "en"));
  return { id: (team as { id: string }).id, name: (team as { name: string | null }).name, members };
}

/** Team names by team id (null = unnamed). */
export async function getTeamNames(teamIds: (string | null | undefined)[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(teamIds.filter((t): t is string => Boolean(t)))];
  const out = new Map<string, string | null>();
  if (ids.length === 0) return out;
  const admin = createAdminClient();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin.from("teams").select("id, name").in("id", ids.slice(i, i + 200));
    if (error) throw queryError("team names", error);
    for (const t of (data ?? []) as { id: string; name: string | null }[]) out.set(t.id, t.name);
  }
  return out;
}
