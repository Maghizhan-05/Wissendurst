import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countRegistrationUnits,
  groupRegistrations,
  isTeamUnitRow,
  registrationUnitKey,
} from "./registration-groups.ts";

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

test("registration units: a solo registration and a whole multi-member team each count once", () => {
  const rows = [
    row("a", "t1", true, 3, "Head"),
    row("b", "t1", false, 3, "Amy"),
    row("c", "t1", false, 3, "Zed"),
    row("d", null, false, 0, "Solo"),
    row("e", "t2", true, 1, "Lone"), // one-person team = a single, like groupRegistrations
    row("f", "t3", true, 2, "Pair"),
    row("g", "t3", false, 2, "Mate"),
  ];
  assert.equal(countRegistrationUnits(rows), 4);
  const { teams, singles } = groupRegistrations(rows);
  assert.equal(countRegistrationUnits(rows), teams.length + singles.length);
  assert.equal(registrationUnitKey(rows[1]), "team:t1");
  assert.equal(registrationUnitKey(rows[4]), "reg:e");
  assert.equal(isTeamUnitRow(rows[0]), true);
  assert.equal(isTeamUnitRow(rows[3]), false);
});

test("registration units: a partial slice of a team still counts the team once; empty is zero", () => {
  assert.equal(countRegistrationUnits([row("b", "t1", false, 3, "Amy")]), 1);
  assert.equal(countRegistrationUnits([]), 0);
  // a team row without its team embed can't be classified as a team
  assert.equal(countRegistrationUnits([{ id: "x", team_id: "t9", team: null }, { id: "y", team_id: "t9", team: null }]), 2);
});
