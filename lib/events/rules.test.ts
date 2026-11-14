import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStoredRules,
  parseRulesText,
  rulesError,
  rulesToEditorText,
} from "./rules.ts";

test("blank lines separate paragraphs; single line breaks stay inside a paragraph", () => {
  const text = "Teams of two.\nBring your own laptop.\n\nNo phones during the round.\r\n\r\n\r\n  Judges' decision is final.  \n";
  assert.deepEqual(parseRulesText(text), [
    "Teams of two.\nBring your own laptop.",
    "No phones during the round.",
    "Judges' decision is final.",
  ]);
});

test("whitespace-only lines also separate paragraphs; empty input gives no rules", () => {
  assert.deepEqual(parseRulesText("A\n   \nB"), ["A", "B"]);
  assert.deepEqual(parseRulesText(""), []);
  assert.deepEqual(parseRulesText("  \n\n \n"), []);
  assert.deepEqual(parseRulesText(undefined), []);
});

test("author numbering is kept verbatim and nothing is added", () => {
  assert.deepEqual(parseRulesText("1. First\n2. Second"), ["1. First\n2. Second"]);
});

test("old one-rule-per-line arrays stay compatible: each line is its own paragraph", () => {
  const stored = ["Teams of two", "Carry your college ID"];
  assert.deepEqual(normalizeStoredRules(stored), stored);
  const editor = rulesToEditorText(stored);
  assert.equal(editor, "Teams of two\n\nCarry your college ID");
  // re-saving unchanged editor text round-trips to the same stored value
  assert.deepEqual(parseRulesText(editor), stored);
});

test("paragraph round trip is lossless", () => {
  const stored = ["Line one\nLine two", "Second paragraph"];
  assert.deepEqual(parseRulesText(rulesToEditorText(stored)), stored);
});

test("unexpected stored shapes are tolerated; empty rules hide the section", () => {
  assert.deepEqual(normalizeStoredRules(null), []);
  assert.deepEqual(normalizeStoredRules({}), []);
  assert.deepEqual(normalizeStoredRules(["ok", 3, "", "  ", null]), ["ok"]);
  assert.deepEqual(normalizeStoredRules("A\n\nB"), ["A", "B"]);
  assert.deepEqual(normalizeStoredRules([]), []);
});

test("limits mirror the database check", () => {
  assert.equal(rulesError(["a"]), null);
  assert.match(rulesError(Array.from({ length: 101 }, () => "a")) ?? "", /at most 100/);
  assert.match(rulesError(["x".repeat(2001)]) ?? "", /at most 2000/);
});
