import assert from "node:assert/strict";
import test from "node:test";
import { coincidenceSignificance, periodicColumnAnalysis } from "../modules/analysis.js";

test("zero IC uses the exact probability of drawing without a collision", () => {
  const significance = coincidenceSignificance(0, 26, 26);
  let expected = 1;
  for (let index = 0; index < 26; index++) expected *= (26 - index) / 26;
  assert.equal(significance.lowerPValue, expected);
  assert.equal(significance.twoSidedPValue, 2 * expected);
  assert.ok(significance.twoSidedPValue < .005);
  assert.ok(significance.upperPValue > .99);
});

test("zero collisions are impossible once the sample exceeds its alphabet", () => {
  const significance = coincidenceSignificance(0, 27, 26);
  assert.equal(significance.lowerPValue, 0);
  assert.equal(significance.twoSidedPValue, 0);
});

test("period analysis keeps its upper-tail p-value for high-IC key searches", () => {
  const result = periodicColumnAnalysis("ABCDABCDABCDABCD", 4);
  assert.equal(result.significance.pValue, result.significance.upperPValue);
  assert.ok(result.significance.upperPValue < result.significance.lowerPValue);
});
