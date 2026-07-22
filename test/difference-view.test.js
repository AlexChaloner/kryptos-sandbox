import assert from "node:assert/strict";
import test from "node:test";
import { gridDifferenceLayout, NORMAL_ALPHABET } from "../modules/cipher.js";

test("horizontal difference view places right-minus-left on the right cell", () => {
  assert.equal(gridDifferenceLayout("ABCD", 2, "horizontal", NORMAL_ALPHABET).text, " B B");
});

test("vertical difference view places below-minus-above on the lower cell", () => {
  assert.equal(gridDifferenceLayout("ABCD", 2, "vertical", NORMAL_ALPHABET).text, "  CC");
});

test("difference view preserves holes and exposes unknown arithmetic", () => {
  const result = gridDifferenceLayout("A? C", 2, "horizontal", NORMAL_ALPHABET);
  assert.equal(result.text, " ?  ");
  assert.equal(result.formulas[1], "? − A = ?");
});
