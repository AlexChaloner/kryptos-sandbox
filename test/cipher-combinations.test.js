import assert from "node:assert/strict";
import test from "node:test";

import {
  GRID_OPERATIONS,
  NORMAL_ALPHABET,
  combineAlignedCipherText,
  combineCipherLetters,
  combineCipherText,
} from "../modules/cipher.js";

test("single-cell addition and both subtraction directions obey A/B labels", () => {
  assert.equal(combineCipherLetters("C", "F", "add", NORMAL_ALPHABET), "H");
  assert.equal(combineCipherLetters("C", "F", "subtract", NORMAL_ALPHABET), "X");
  assert.equal(combineCipherLetters("C", "F", "reverseSubtract", NORMAL_ALPHABET), "D");
});

test("every flat combination truncates at the shorter sequence without wrapping rows", () => {
  const operandA = { text: "ABCDEF", cols: 2 };
  const operandB = { text: "ZYX", cols: 3 };
  for (const operation of Object.keys(GRID_OPERATIONS)) {
    const expected = [0, 1, 2]
      .map(index => combineCipherLetters(operandA.text[index], operandB.text[index], operation, NORMAL_ALPHABET))
      .join("");
    assert.equal(combineCipherText(operandA, operandB, operation, NORMAL_ALPHABET), expected);
  }
});

test("aligned output exposes both the sparse layout and an explicit compact representation", () => {
  const operandA = { text: "AB CD", cols: 3 };
  const operandB = { text: "Z YXW", cols: 3 };
  const result = combineAlignedCipherText(operandA, operandB, "add", NORMAL_ALPHABET, {
    topOperand: "a",
    rowOffset: 0,
    columnOffset: 0,
  });
  assert.equal(result.text.length, operandA.text.length);
  assert.equal(result.compactText, result.matches.filter(match => match.result !== " ").map(match => match.result).join(""));
  assert.equal(result.compactText.includes(" "), false);
});

test("unknown and out-of-alphabet symbols produce explicit unknowns, not missing cells", () => {
  assert.equal(combineCipherLetters("?", "A", "add", NORMAL_ALPHABET), "?");
  assert.equal(combineCipherLetters("A", "!", "add", NORMAL_ALPHABET), "?");
  assert.equal(combineCipherLetters(" ", "A", "add", NORMAL_ALPHABET), " ");
});
