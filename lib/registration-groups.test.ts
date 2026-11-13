import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRegistrations } from "./registration-groups.ts";

const row = (id: string, team: string | null, head: boolean, size: number, name: string, at = "2026-11-01") => ({
  id,
  team_id: team,
  is_team_head: head,
  registered_at: at,
  team: team ? { name: team === "t1" ? "Alpha" : null, member_count: size, code: size >= 2 ? `W27/T/${team}` : null } : null,
  profile: { full_name: name },
});

test("a team of three is one team registration; solo and one-person teams are singles", () => {
  const { teams, singles } = groupRegistrations([
    row("a", "t1", false, 3, "Zed"),
    row("b", "t1", true, 3, "Head"),
    row("c", "t1", false, 3, "Amy"),
    row("d", null, false, 0, "Solo"),
    row("e", "t2", true, 1, "Lone"),
  ]);
  assert.equal(teams.length, 1);
  assert.equal(teams[0].code, "W27/T/t1");
  assert.equal(teams[0].name, "Alpha");
  assert.deepEqual(teams[0].members.map((m) => m.id), ["b", "c", "a"]);
  assert.deepEqual(singles.map((s) => s.id), ["d", "e"]);
});

test("teams are newest first", () => {
  const { teams } = groupRegistrations([
    row("a", "t1", true, 2, "A", "2026-11-01"),
    row("b", "t1", false, 2, "B", "2026-11-01"),
    row("c", "t3", true, 2, "C", "2026-11-05"),
    row("d", "t3", false, 2, "D", "2026-11-05"),
  ]);
  assert.deepEqual(teams.map((t) => t.teamId), ["t3", "t1"]);
});
