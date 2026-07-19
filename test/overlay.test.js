import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  GRID_OPERATIONS,
  KRYPTOS_ALPHABET,
  KRYPTOS_LEFT_PLATE,
  KRYPTOS_LEFT_PLATE_COLUMNS,
  KRYPTOS_RIGHT_PLATE,
  KRYPTOS_RIGHT_PLATE_COLUMNS,
  NORMAL_ALPHABET,
  combineCipherLetters,
} from "../modules/cipher.js";
import {
  alignmentFromCellGeometry,
  compactSparseLayout,
  createOverlayLink,
  findOverlayLink,
  materializedOverlayLayout,
  normalizeOverlayLink,
  overlayPosition,
  removeCyclicOverlayLinks,
  removeOverlayLinksForGrid,
  resolveOverlayLink,
} from "../modules/overlay.js";

function grid(id, text, cols, x = 0, y = 0) {
  return { id, text, cols, x, y, cellSize: 28 };
}

function link(overrides = {}) {
  return createOverlayLink({
    id: "link",
    baseId: "base",
    overlayId: "overlay",
    rowOffset: 0,
    columnOffset: 0,
    operation: "add",
    ...overrides,
  });
}

function oracle(base, overlay, rowOffset, columnOffset, operation, alphabet) {
  const baseRows = Math.ceil(base.text.length / base.cols);
  const matches = [];
  let compactText = "";
  const text = Array(overlay.text.length).fill(" ");
  for (let overlayIndex = 0; overlayIndex < overlay.text.length; overlayIndex++) {
    const baseRow = Math.floor(overlayIndex / overlay.cols) + rowOffset;
    const baseColumn = overlayIndex % overlay.cols + columnOffset;
    const baseIndex = baseRow * base.cols + baseColumn;
    if (baseRow < 0 || baseRow >= baseRows || baseColumn < 0 || baseColumn >= base.cols || baseIndex < 0 || baseIndex >= base.text.length) continue;
    const result = combineCipherLetters(overlay.text[overlayIndex], base.text[baseIndex], operation, alphabet);
    matches.push({ topIndex: overlayIndex, baseIndex, result });
    text[overlayIndex] = result;
    if (result !== " ") compactText += result;
  }
  return { matches, compactText, text: text.join("") };
}

test("legacy links migrate to an explicit, stable A/B order", () => {
  const migrated = normalizeOverlayLink({
    id: "old",
    baseId: "base",
    overlayId: "overlay",
    rowOffset: 1.4,
    columnOffset: -2.6,
    operation: "subtract",
  });
  assert.equal(migrated.operandAId, "overlay");
  assert.equal(migrated.operandBId, "base");
  assert.equal(migrated.rowOffset, 1);
  assert.equal(migrated.columnOffset, -3);
});

test("live A/B semantics do not depend on later selection order", () => {
  const base = grid("base", "BCDEFG", 2);
  const overlay = grid("overlay", "AAAAAAAAA", 3);
  const grids = [base, overlay];

  const add = resolveOverlayLink(link({ operation: "add" }), grids, NORMAL_ALPHABET);
  const subtract = resolveOverlayLink(link({ operation: "subtract" }), grids, NORMAL_ALPHABET);
  const reverse = resolveOverlayLink(link({ operation: "reverseSubtract" }), grids, NORMAL_ALPHABET);

  assert.equal(add.combined.compactText, "BCDEFG");
  assert.equal(subtract.combined.compactText, "ZYXWVU");
  assert.equal(reverse.combined.compactText, "BCDEFG");
  assert.equal(subtract.operandA.id, "overlay");
  assert.equal(subtract.operandB.id, "base");
  assert.equal(subtract.alignment.topOperand, "a");
});

test("an explicitly reversed physical stack still preserves semantic A and B", () => {
  const base = grid("base", "BCDEFG", 2);
  const overlay = grid("overlay", "AAAAAAAAA", 3);
  const reversedLink = {
    ...link({ operation: "subtract" }),
    operandAId: "base",
    operandBId: "overlay",
  };
  const resolved = resolveOverlayLink(reversedLink, [base, overlay], NORMAL_ALPHABET);
  assert.equal(resolved.alignment.topOperand, "b");
  assert.equal(resolved.combined.compactText, "BCDEFG");
});

test("all operations match an independent row/column oracle at positive and negative offsets", () => {
  const base = grid("base", "ABCDEFGHIJKLMNOPQ", 5);
  const overlay = grid("overlay", "ZYXWVUTSRQPONMLKJIH", 4);
  const grids = [base, overlay];
  for (const [rowOffset, columnOffset] of [[0, 0], [1, 2], [-2, -1], [2, -3]]) {
    for (const operation of Object.keys(GRID_OPERATIONS)) {
      const resolved = resolveOverlayLink(link({ rowOffset, columnOffset, operation }), grids, NORMAL_ALPHABET);
      const expected = oracle(base, overlay, rowOffset, columnOffset, operation, NORMAL_ALPHABET);
      assert.equal(resolved.combined.text, expected.text, `sparse layout for ${operation} at ${rowOffset},${columnOffset}`);
      assert.equal(resolved.combined.compactText, expected.compactText, `${operation} at ${rowOffset},${columnOffset}`);
      assert.deepEqual(
        resolved.combined.matches.map(({ topIndex, baseIndex, result }) => ({ topIndex, baseIndex, result })),
        expected.matches,
        `${operation} indices at ${rowOffset},${columnOffset}`,
      );
    }
  }
});

test("partial final rows never wrap into a nonexistent neighbouring cell", () => {
  const base = grid("base", "ABCDEFG", 3);
  const overlay = grid("overlay", "ZZZZZZZZZ", 3);
  const resolved = resolveOverlayLink(link({ rowOffset: 0, columnOffset: 1 }), [base, overlay], NORMAL_ALPHABET);
  assert.deepEqual(resolved.combined.matches.map(match => match.baseIndex), [1, 2, 4, 5]);
});

test("sparse padding and non-overlap remain holes in the live materialized layout", () => {
  const base = grid("base", "AB CDE F", 3);
  const overlay = grid("overlay", "Z YX WVU", 3);
  const resolved = resolveOverlayLink(link(), [base, overlay], NORMAL_ALPHABET);
  assert.equal(resolved.combined.alignedCount, 8);
  assert.equal(resolved.combined.combinedCount, 4);
  assert.equal(resolved.combined.text, "Z  Z A Z");
  assert.equal(resolved.combined.columns, 3);
  assert.equal(resolved.combined.compactText.includes(" "), false);
  assert.equal(resolved.combined.matches.filter(match => match.result !== " ").length, 4);
});

test("the complete Kryptos plates retain the 33-column top-plate layout for every operation", () => {
  const base = grid("base", KRYPTOS_RIGHT_PLATE, KRYPTOS_RIGHT_PLATE_COLUMNS);
  const overlay = grid("overlay", KRYPTOS_LEFT_PLATE, KRYPTOS_LEFT_PLATE_COLUMNS);
  for (const operation of Object.keys(GRID_OPERATIONS)) {
    const resolved = resolveOverlayLink(link({ operation }), [base, overlay], KRYPTOS_ALPHABET);
    assert.equal(resolved.combined.alignedCount, 896, operation);
    assert.equal(resolved.combined.combinedCount, 860, operation);
    assert.equal(resolved.combined.text.length, KRYPTOS_LEFT_PLATE.length, operation);
    assert.equal([...resolved.combined.text].filter(letter => letter === " ").length, 64, operation);
    assert.equal(resolved.combined.columns, KRYPTOS_LEFT_PLATE_COLUMNS, operation);
    assert.equal(resolved.combined.compactText.length, 860, operation);
    assert.equal(resolved.combined.compactText.includes(" "), false, operation);
    assert.equal(resolved.combined.overlapColumns, 32, operation);
  }
});

test("compacting is an explicit layout transformation with stable index mapping", () => {
  assert.deepEqual(compactSparseLayout("A B  C", 3, 2), {
    text: "ABC",
    columns: 2,
    indexMap: [0, -1, 1, -1, -1, 2],
  });
  const plates = compactSparseLayout("A".repeat(10) + "   " + "B".repeat(10), 33, 32);
  assert.equal(plates.text, "A".repeat(10) + "B".repeat(10));
  assert.equal(plates.columns, 20);
});

test("live materialization defaults to sparse and only compacts when explicitly requested", () => {
  const resolved = resolveOverlayLink(
    link(),
    [grid("base", "AB CDE F", 3), grid("overlay", "Z YX WVU", 3)],
    NORMAL_ALPHABET,
  );
  assert.deepEqual(materializedOverlayLayout(resolved.combined), { text: "Z  Z A Z", columns: 3 });
  assert.deepEqual(materializedOverlayLayout(resolved.combined, true), { text: "ZZAZ", columns: 3 });
});

test("a materialized live layout is a frozen value when operands and operation later change", () => {
  const base = grid("base", "ABCDEF", 3);
  const overlay = grid("overlay", "ZYXWVU", 3);
  const overlayLink = link({ operation: "subtract" });
  const frozen = materializedOverlayLayout(resolveOverlayLink(overlayLink, [base, overlay], NORMAL_ALPHABET).combined);
  const snapshot = { ...frozen };

  base.text = "AAAAAA";
  overlayLink.operation = "add";
  const changedLiveResult = materializedOverlayLayout(resolveOverlayLink(overlayLink, [base, overlay], NORMAL_ALPHABET).combined);

  assert.deepEqual(frozen, snapshot);
  assert.notDeepEqual(changedLiveResult, frozen);
});

test("result width is recalculated if either source is reshaped", () => {
  const base = grid("base", "A".repeat(48), 8);
  const overlay = grid("overlay", "B".repeat(48), 6);
  const overlayLink = link({ columnOffset: 1 });
  assert.equal(resolveOverlayLink(overlayLink, [base, overlay], NORMAL_ALPHABET).combined.overlapColumns, 6);
  base.cols = 4;
  assert.equal(resolveOverlayLink(overlayLink, [base, overlay], NORMAL_ALPHABET).combined.overlapColumns, 3);
});

test("preview geometry selects one nearest alignment and rejects weak overlap", () => {
  assert.deepEqual(
    alignmentFromCellGeometry({ deltaX: 31, deltaY: -29, baseCellWidth: 28, baseCellHeight: 28 }),
    { rowOffset: -1, columnOffset: 1, overlapRatio: 27 / 28 * 27 / 28 },
  );
  assert.equal(
    alignmentFromCellGeometry({
      deltaX: 27,
      deltaY: 27,
      baseCellWidth: 28,
      baseCellHeight: 28,
      overlayCellWidth: 4,
      overlayCellHeight: 4,
    }),
    null,
  );
});

test("moving either half removes ghost links, while unrelated links survive", () => {
  const links = [
    link(),
    createOverlayLink({ id: "other", baseId: "c", overlayId: "d", rowOffset: 0, columnOffset: 0, operation: "add" }),
  ];
  assert.deepEqual(removeOverlayLinksForGrid(links, "base").map(item => item.id), ["other"]);
  assert.deepEqual(removeOverlayLinksForGrid(links, "overlay").map(item => item.id), ["other"]);
  const found = findOverlayLink(links, "base", "overlay");
  assert.equal(found.id, "link");
  assert.equal(found, links[0]);
  found.operation = "subtract";
  assert.equal(links[0].operation, "subtract");
  assert.equal(findOverlayLink(links, "overlay", "base").id, "link");
});

test("legacy cyclic links are pruned instead of making positions oscillate", () => {
  const cycle = [
    createOverlayLink({ id: "a-over-b", baseId: "b", overlayId: "a", rowOffset: 1, columnOffset: 0, operation: "add" }),
    createOverlayLink({ id: "b-over-a", baseId: "a", overlayId: "b", rowOffset: 0, columnOffset: 1, operation: "add" }),
    createOverlayLink({ id: "c-over-a", baseId: "a", overlayId: "c", rowOffset: 0, columnOffset: 0, operation: "add" }),
  ];
  assert.deepEqual(removeCyclicOverlayLinks(cycle).map(item => item.id), ["a-over-b", "c-over-a"]);
});

test("linked positions remain cell-aligned when the global cell size changes", () => {
  const base = grid("base", "AAAA", 2, 100, 200);
  const overlayLink = link({ rowOffset: -3, columnOffset: 4 });
  assert.deepEqual(overlayPosition(base, overlayLink, 28), { x: 220, y: 110 });
  assert.deepEqual(overlayPosition(base, overlayLink, 40), { x: 268, y: 74 });
  assert.deepEqual(overlayPosition(base, overlayLink, 28, 2, 0.8), { x: 196, y: 128 });
});

test("zoom-aware stored positions resolve to the same offsets used by preview", () => {
  const base = grid("base", "A", 1, 400, 300);
  for (const scale of [0.6, 0.8, 1, 1.2, 1.5]) {
    for (const rowOffset of [-7, -1, 0, 2, 9]) {
      for (const columnOffset of [-6, -1, 0, 3, 8]) {
        const position = overlayPosition(base, link({ rowOffset, columnOffset }), 28, 2, scale);
        const alignment = alignmentFromCellGeometry({
          deltaX: position.x - base.x,
          deltaY: position.y - base.y,
          baseCellWidth: 28 * scale,
          baseCellHeight: 28 * scale,
          horizontalGap: 2 * scale,
          verticalGap: 2 * scale,
        });
        assert.equal(alignment.rowOffset, rowOffset);
        assert.equal(alignment.columnOffset, columnOffset);
      }
    }
  }
});

test("randomized unequal, partial, sparse grids match the independent oracle", () => {
  let seed = 0x4b525950;
  const random = maximum => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed % maximum;
  };
  const symbols = `${NORMAL_ALPHABET}  ?`;
  const makeText = length => Array.from({ length }, () => symbols[random(symbols.length)]).join("");
  const operations = Object.keys(GRID_OPERATIONS);
  for (let iteration = 0; iteration < 300; iteration++) {
    const baseColumns = 1 + random(24);
    const overlayColumns = 1 + random(24);
    const base = grid("base", makeText(1 + random(baseColumns * 20)), baseColumns);
    const overlay = grid("overlay", makeText(1 + random(overlayColumns * 20)), overlayColumns);
    const rowOffset = random(31) - 15;
    const columnOffset = random(31) - 15;
    const operation = operations[random(operations.length)];
    const resolved = resolveOverlayLink(link({ rowOffset, columnOffset, operation }), [base, overlay], NORMAL_ALPHABET);
    const expected = oracle(base, overlay, rowOffset, columnOffset, operation, NORMAL_ALPHABET);
    assert.equal(resolved.combined.text, expected.text, `layout in iteration ${iteration}`);
    assert.equal(resolved.combined.compactText, expected.compactText, `iteration ${iteration}`);
    assert.deepEqual(
      resolved.combined.matches.map(({ topIndex, baseIndex, result }) => ({ topIndex, baseIndex, result })),
      expected.matches,
      `indices in iteration ${iteration}`,
    );
  }
});

test("large unequal grids match the oracle for every operation", { timeout: 5000 }, () => {
  const alphabet = NORMAL_ALPHABET;
  const makeText = (length, shift) => Array.from({ length }, (_, index) => alphabet[(index * 17 + shift) % alphabet.length]).join("");
  const base = grid("base", makeText(241 * 240 - 17, 3), 241);
  const overlay = grid("overlay", makeText(239 * 260 - 29, 11), 239);
  const started = performance.now();
  for (const operation of Object.keys(GRID_OPERATIONS)) {
    const overlayLink = link({ rowOffset: -17, columnOffset: 13, operation });
    const resolved = resolveOverlayLink(overlayLink, [base, overlay], alphabet);
    const expected = oracle(base, overlay, -17, 13, operation, alphabet);
    assert.equal(resolved.combined.text, expected.text);
    assert.equal(resolved.combined.compactText, expected.compactText);
    assert.equal(resolved.combined.matches.length, expected.matches.length);
    assert.deepEqual(resolved.combined.matches.at(-1), {
      ...expected.matches.at(-1),
      a: overlay.text[expected.matches.at(-1).topIndex],
      b: base.text[expected.matches.at(-1).baseIndex],
    });
  }
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 4000, `large-grid operation matrix took ${elapsed.toFixed(1)}ms`);
});
