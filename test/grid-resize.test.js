import assert from "node:assert/strict";
import test from "node:test";
import {
  DIFFERENCE_CELL_RATIO,
  GRID_HEIGHT_CHROME,
  GRID_WIDTH_CHROME,
  closestColumnsForRows,
  columnsForResizeDrag,
  differenceCellSize,
  gridAxisExtent,
  gridGeometry,
  gridTrackSizes,
  resizeAxisForMovement,
  sourceCountFromRenderedExtent,
} from "../modules/grid-resize.js";

const CELL_SIZE = 28;

test("one geometry model describes source, horizontal, vertical, and combined layouts", () => {
  const source = gridGeometry({ textLength: 50, columns: 10, cellSize: CELL_SIZE });
  const horizontal = gridGeometry({ textLength: 50, columns: 10, cellSize: CELL_SIZE, horizontalDifferences: true });
  const vertical = gridGeometry({ textLength: 50, columns: 10, cellSize: CELL_SIZE, verticalDifferences: true });
  const combined = gridGeometry({
    textLength: 50,
    columns: 10,
    cellSize: CELL_SIZE,
    horizontalDifferences: true,
    verticalDifferences: true,
  });

  assert.deepEqual(
    [source.sourceColumns, source.sourceRows, source.displayColumns, source.displayRows],
    [10, 5, 10, 5],
  );
  assert.deepEqual([horizontal.displayColumns, horizontal.displayRows], [19, 5]);
  assert.deepEqual([vertical.displayColumns, vertical.displayRows], [10, 9]);
  assert.deepEqual([combined.displayColumns, combined.displayRows], [19, 9]);
  assert.equal(combined.renderedWidth, gridAxisExtent(10, CELL_SIZE, GRID_WIDTH_CHROME, true));
  assert.equal(combined.renderedHeight, gridAxisExtent(5, CELL_SIZE, GRID_HEIGHT_CHROME, true));
});

test("difference tracks and cells occupy seventy percent of a source cell", () => {
  assert.equal(DIFFERENCE_CELL_RATIO, 0.7);
  assert.equal(differenceCellSize(20), 14);
  assert.deepEqual(gridTrackSizes(3, 20, true), [20, 14, 20, 14, 20]);
  assert.equal(
    gridAxisExtent(3, 20, GRID_WIDTH_CHROME, true),
    GRID_WIDTH_CHROME + 20 * 3 + 14 * 2 + 2 * 4,
  );
});

test("rendered extents invert exactly across cell sizes and difference modes", () => {
  for (const cellSize of [20, 28, 64]) {
    for (const expanded of [false, true]) {
      for (let sourceCount = 1; sourceCount <= 500; sourceCount++) {
        const extent = gridAxisExtent(sourceCount, cellSize, GRID_WIDTH_CHROME, expanded);
        assert.equal(
          sourceCountFromRenderedExtent(extent, cellSize, GRID_WIDTH_CHROME, expanded, 500),
          sourceCount,
        );
      }
    }
  }
});

test("vertical resizing preserves columns within the same achievable row bucket", () => {
  assert.equal(closestColumnsForRows(4, 2, 3), 3);
  assert.equal(closestColumnsForRows(97, 15, 7), 7);
  assert.equal(closestColumnsForRows(97, 16, 7), 6);
  for (let textLength = 1; textLength <= 200; textLength++) {
    for (let columns = 1; columns <= Math.min(50, textLength); columns++) {
      const currentRows = Math.ceil(textLength / columns);
      assert.equal(closestColumnsForRows(textLength, currentRows, columns), columns);
    }
  }
});

test("one resize resolver handles horizontal and vertical difference geometry", () => {
  const start = gridGeometry({
    textLength: 97,
    columns: 7,
    cellSize: CELL_SIZE,
    horizontalDifferences: true,
    verticalDifferences: true,
  });
  const common = {
    startColumns: 7,
    textLength: 97,
    cellSize: CELL_SIZE,
    startWidth: start.renderedWidth,
    startHeight: start.renderedHeight,
    horizontalDifferences: true,
    verticalDifferences: true,
  };

  assert.deepEqual(columnsForResizeDrag({ ...common, deltaX: 60, deltaY: 0 }), { axis: "width", columns: 8 });
  assert.deepEqual(columnsForResizeDrag({ ...common, deltaX: 0, deltaY: 60 }), { axis: "height", columns: 7 });
  assert.deepEqual(columnsForResizeDrag({ ...common, deltaX: 0, deltaY: 120 }), { axis: "height", columns: 6 });
});

test("resize direction can switch freely during one diagonal drag", () => {
  assert.equal(resizeAxisForMovement(5, 9), "height");
  assert.equal(resizeAxisForMovement(12, 9), "width");
  assert.equal(resizeAxisForMovement(12, 18), "height");
  assert.equal(resizeAxisForMovement(24, 18), "width");
});
