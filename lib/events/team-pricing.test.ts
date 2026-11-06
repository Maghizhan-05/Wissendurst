import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTierRupees, priceForSize, teamPriceSummary } from "./team-pricing.ts";

const inr = (p: number) => `₹${p / 100}`;

test("priceForSize picks the exact size and refuses unpriced sizes", () => {
  const prices = [15000, 30000, 40000];
  assert.equal(priceForSize(prices, 1), 15000);
  assert.equal(priceForSize(prices, 3), 40000);
  assert.equal(priceForSize(prices, 4), null);
  assert.equal(priceForSize(prices, 0), null);
  assert.equal(priceForSize(prices, 1.5), null);
});

test("teamPriceSummary", () => {
  assert.equal(teamPriceSummary([15000, 30000, 40000, 60000], 1, inr), "₹150 solo · teams ₹300–₹600");
  assert.equal(teamPriceSummary([15000, 30000, 30000], 1, inr), "₹150 solo · teams ₹300");
  assert.equal(teamPriceSummary([15000], 1, inr), "₹150 solo");
  assert.equal(teamPriceSummary([15000, 30000, 40000, 50000], 3, inr), "Teams ₹400–₹500");
  assert.equal(teamPriceSummary([], 1, inr), "");
});

test("parseTierRupees validates every size 1..max", () => {
  assert.deepEqual(parseTierRupees(["150", "300", "0"], 3), { ok: true, prices: [15000, 30000, 0] });
  const bad = parseTierRupees(["150", "-5", "4.5", "", "abc"], 5);
  assert.equal(bad.ok, false);
  assert.deepEqual(!bad.ok && bad.errors, [
    { size: 2, message: "Can't be negative" },
    { size: 3, message: "Whole rupees only" },
    { size: 4, message: "Set a price for teams of 4" },
    { size: 5, message: "Enter a number" },
  ]);
  // extra inputs beyond the max are ignored (they're dropped on save)
  assert.deepEqual(parseTierRupees(["1", "2", "3"], 2), { ok: true, prices: [100, 200] });
});
