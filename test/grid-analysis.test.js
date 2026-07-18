import test from "node:test";
import assert from "node:assert/strict";
import { enumerateGridLines, generateGridRoutes, scanGridDiagnostics, scanGridRoutes } from "../modules/grid-analysis.js";
import { ngramScore, scoreRouteCandidatesWithModels } from "../modules/transposition-analysis.js";

test("grid diagnostics enumerate physical rows, columns, and both diagonal families", () => {
  const lines = enumerateGridLines("ABCDEFGHI", 3);
  assert.deepEqual(lines.filter(line => line.kind === "row").map(line => line.route), ["ABC", "DEF", "GHI"]);
  assert.deepEqual(lines.filter(line => line.kind === "column").map(line => line.route), ["ADG", "BEH", "CFI"]);
  assert.deepEqual(lines.filter(line => line.direction === "backslash").map(line => line.route), ["BF", "AEI", "DH"]);
  assert.deepEqual(lines.filter(line => line.direction === "slash").map(line => line.route), ["BD", "CEG", "FH"]);
});

test("diagnostic lines preserve sparse source indices instead of compacting holes", () => {
  const lines = enumerateGridLines("A CDE G I", 3, { minimumLetters: 1 });
  const firstRow = lines.find(line => line.id === "row-0");
  const middleColumn = lines.find(line => line.id === "column-1");
  assert.equal(firstRow.route, "AC");
  assert.deepEqual(firstRow.indices, [0, 2]);
  assert.equal(middleColumn.route, "E");
});

test("shape-aware routes include straight, snake, column, diagonal, and spiral traversals", () => {
  const routes = generateGridRoutes("ABCDEFGHI", 3);
  const byId = id => routes.find(route => route.id === id)?.route;
  assert.equal(byId("rows-top-left"), "ABCDEFGHI");
  assert.equal(byId("rows-top-right"), "CBAFEDIHG");
  assert.equal(byId("row-snake-top-left"), "ABCFEDGHI");
  assert.equal(byId("columns-left-top"), "ADGBEHCFI");
  assert.equal(byId("spiral-NW-cw"), "ABCFIHGDE");
  assert.ok(routes.some(route => route.family === "diagonals"));
});

test("every route visits each non-hole cell exactly once", () => {
  const text = "AB DEFG IJK MNOP";
  const expected = [...text].filter(letter => /[A-Z]/.test(letter)).sort().join("");
  const routes = generateGridRoutes(text, 4);
  assert.ok(routes.length >= 20);
  for (const route of routes) {
    assert.equal([...route.route].sort().join(""), expected, route.label);
    assert.equal(new Set(route.indices).size, route.indices.length, route.label);
  }
  assert.equal(new Set(routes.map(route => route.indices.join(","))).size, routes.length);
});

test("shared route scoring ranks candidates and remains usable by a future annealer", () => {
  const model = {
    table: { AB: -0.1, BC: -0.1, CD: -0.1, DC: -3, CB: -3, BA: -3 },
    floor: -5,
  };
  const models = { 2: model };
  const candidates = scoreRouteCandidatesWithModels([
    { id: "forward", route: "ABCD" },
    { id: "reverse", route: "DCBA" },
  ], models, { ngramSizes: [2] });
  assert.ok(candidates.find(candidate => candidate.id === "forward").score > candidates.find(candidate => candidate.id === "reverse").score);
  assert.ok(Math.abs(ngramScore("ABCD", 2, model, false) + 0.1) < 1e-12);
});

test("diagnostic and route scans accept a shared preloaded model", async () => {
  const model = { table: { AB: -0.1, BC: -0.1, CD: -0.1 }, floor: -4 };
  const options = { models: { 2: model }, ngramSizes: [2] };
  const diagnostics = await scanGridDiagnostics("ABCDEFGHIJKLMNOP", 4, options);
  const routes = await scanGridRoutes("ABCDEFGHIJKLMNOP", 4, options);
  assert.ok(diagnostics.candidates.every(candidate => Number.isFinite(candidate.ic) && Number.isFinite(candidate.frequencyFit)));
  assert.ok(routes.candidates.length >= 20);
  assert.ok(routes.candidates.every(candidate => Number.isFinite(candidate.score)));
  assert.ok(routes.candidates.every((candidate, index, all) => index === 0 || all[index - 1].score >= candidate.score));
});

test("large route generation is bounded and deterministic", () => {
  const text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(385).slice(0, 10_000);
  const started = performance.now();
  const first = generateGridRoutes(text, 100);
  const elapsed = performance.now() - started;
  const second = generateGridRoutes(text, 100);
  assert.ok(first.length <= 32);
  assert.deepEqual(first.map(route => route.indices), second.map(route => route.indices));
  assert.ok(elapsed < 1000, `10,000-cell route generation took ${elapsed.toFixed(1)}ms`);
});
