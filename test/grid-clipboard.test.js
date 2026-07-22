import assert from "node:assert/strict";
import test from "node:test";
import { createGridBundle, instantiateGridBundle } from "../modules/grid-clipboard.js";

test("grid bundles preserve relative geometry and remap internal relationships", () => {
  const grids = [
    { id: "a", name: "A", text: "ABCD", cols: 2, x: 100, y: 60, selected: new Set(), highlights: { 1: "cyan" } },
    { id: "b", name: "B", text: "EFGH", cols: 2, x: 180, y: 140, selected: new Set(), highlights: {}, syncSourceId: "a" },
  ];
  const bundle = createGridBundle(grids, ["a", "b"], [{ id: "link", baseId: "a", overlayId: "b", operandAId: "b", operandBId: "a" }]);
  let number = 0;
  const pasted = instantiateGridBundle(bundle, { anchorX: 20, anchorY: 30, idFactory: prefix => `${prefix || "grid"}-${++number}`, nextZ: () => ++number });
  assert.deepEqual(pasted.grids.map(grid => [grid.x, grid.y]), [[20, 30], [100, 110]]);
  assert.equal(pasted.grids[1].syncSourceId, pasted.grids[0].id);
  assert.equal(pasted.overlays[0].baseId, pasted.grids[0].id);
  assert.equal(pasted.overlays[0].overlayId, pasted.grids[1].id);
  assert.equal(pasted.grids[0].highlights[1], "cyan");
});

test("external derived links are detached when only one grid is copied", () => {
  const bundle = createGridBundle([
    { id: "result", name: "Result", text: "AB", cols: 2, x: 0, y: 0, selected: new Set(), derived: { baseId: "missing-a", overlayId: "missing-b", operation: "add" } },
  ], ["result"]);
  const pasted = instantiateGridBundle(bundle, { anchorX: 0, anchorY: 0, idFactory: () => "copy", nextZ: () => 1 });
  assert.equal(pasted.grids[0].derived, null);
});
