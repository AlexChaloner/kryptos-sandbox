import assert from "node:assert/strict";
import test from "node:test";
import { gridDifferenceLayout, NORMAL_ALPHABET } from "../modules/cipher.js";

test("horizontal difference view places right-minus-left on the right cell", () => {
  const result = gridDifferenceLayout("ABCD", 2, { horizontal: true }, NORMAL_ALPHABET);
  assert.equal(result.text, "ABBCBD");
  assert.equal(result.columns, 3);
  assert.deepEqual(result.kinds, ["source", "horizontal", "source", "source", "horizontal", "source"]);
});

test("vertical difference view places below-minus-above on the lower cell", () => {
  const result = gridDifferenceLayout("ABCD", 2, { vertical: true }, NORMAL_ALPHABET);
  assert.equal(result.text, "ABCCCD");
  assert.equal(result.rows, 3);
});

test("horizontal and vertical differences compose with empty intersections", () => {
  const result = gridDifferenceLayout("ABCD", 2, { horizontal: true, vertical: true }, NORMAL_ALPHABET);
  assert.equal(result.text, "ABBC CCBD");
  assert.equal(result.columns, 3);
  assert.equal(result.rows, 3);
  assert.equal(result.kinds[4], "empty");
});

test("combined differences preserve a partial final row", () => {
  const result = gridDifferenceLayout("ABCDE", 3, { horizontal: true, vertical: true }, NORMAL_ALPHABET);
  assert.deepEqual(
    Array.from({ length: result.rows }, (_, row) => result.text.slice(row * result.columns, (row + 1) * result.columns)),
    ["ABBBC", "D D  ", "DBE  "],
  );
  assert.equal(result.sourceIndices[14], null);
});

test("difference view preserves holes and exposes unknown arithmetic", () => {
  const result = gridDifferenceLayout("A? C", 2, { horizontal: true }, NORMAL_ALPHABET);
  assert.equal(result.text, "A??  C");
  assert.equal(result.formulas[1], "? − A = ?");
});
