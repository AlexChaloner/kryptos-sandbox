import assert from "node:assert/strict";
import test from "node:test";
import { scaleCanvasPositions } from "../modules/viewport.js";

test("canvas zoom scales the distance between grids around its pointer anchor", () => {
  const result = scaleCanvasPositions([
    { id: "left", x: 100, y: 100 },
    { id: "right", x: 300, y: 200 },
  ], 1, 2, { x: 200, y: 150 });
  assert.deepEqual(result.positions, [
    { id: "left", x: 0, y: 50 },
    { id: "right", x: 400, y: 250 },
  ]);
  assert.equal(result.positions[1].x - result.positions[0].x, 400);
});

test("negative zoomed positions are shifted with an equal scroll adjustment", () => {
  const result = scaleCanvasPositions([{ id: "grid", x: 100, y: 80 }], 1, 2, { x: 500, y: 400 });
  assert.deepEqual(result.positions, [{ id: "grid", x: 0, y: 0 }]);
  assert.deepEqual(result.scrollAdjustment, { x: 300, y: 240 });
});
