import { test } from "node:test";
import assert from "node:assert/strict";
import { teamDisplay, teamLabel, UNNAMED_TEAM } from "./team-label.ts";

test("teamLabel falls back to Unnamed team", () => {
  assert.equal(teamLabel("Synapse Squad"), "Synapse Squad");
  assert.equal(teamLabel(null), UNNAMED_TEAM);
  assert.equal(teamLabel(""), UNNAMED_TEAM);
  assert.equal(teamLabel("   "), UNNAMED_TEAM);
});

test("teamDisplay hides solo teams and names the rest", () => {
  assert.equal(teamDisplay(null), null);
  assert.equal(teamDisplay({ name: null, member_count: 1 }), null);
  assert.equal(teamDisplay({ name: null, member_count: 3 }), UNNAMED_TEAM);
  assert.equal(teamDisplay({ name: "Pair", member_count: 2 }), "Pair");
});
