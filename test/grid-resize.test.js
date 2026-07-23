import assert from "node:assert/strict";
import test from "node:test";
import { renderedTrackCount, sourceCountFromRenderedExtent } from "../modules/grid-resize.js";

const CELL_SIZE = 28;
const WIDTH_CHROME = 20;
const HEIGHT_CHROME = 54;
const extentFor = (tracks, chrome) => chrome - 2 + tracks * (CELL_SIZE + 2);

test("expanded horizontal width maps back to source columns", () => {
  const displayedColumns = renderedTrackCount(10, true);
  const width = extentFor(displayedColumns, WIDTH_CHROME);
  assert.equal(displayedColumns, 19);
  assert.equal(sourceCountFromRenderedExtent(width, CELL_SIZE, WIDTH_CHROME, true), 10);
  assert.equal(sourceCountFromRenderedExtent(width + 31, CELL_SIZE, WIDTH_CHROME, true), 11);
  assert.equal(sourceCountFromRenderedExtent(width - 31, CELL_SIZE, WIDTH_CHROME, true), 9);
});

test("expanded vertical height maps back to source rows", () => {
  const displayedRows = renderedTrackCount(5, true);
  const height = extentFor(displayedRows, HEIGHT_CHROME);
  assert.equal(displayedRows, 9);
  assert.equal(sourceCountFromRenderedExtent(height, CELL_SIZE, HEIGHT_CHROME, true, 100), 5);
  assert.equal(sourceCountFromRenderedExtent(height + 31, CELL_SIZE, HEIGHT_CHROME, true, 100), 6);
  assert.equal(sourceCountFromRenderedExtent(height - 31, CELL_SIZE, HEIGHT_CHROME, true, 100), 4);
});

test("ordinary axes and resize limits remain supported", () => {
  const width = extentFor(10, WIDTH_CHROME);
  assert.equal(sourceCountFromRenderedExtent(width, CELL_SIZE, WIDTH_CHROME, false), 10);
  assert.equal(sourceCountFromRenderedExtent(1_000_000, CELL_SIZE, WIDTH_CHROME, true, 500), 500);
  assert.equal(sourceCountFromRenderedExtent(-1_000, CELL_SIZE, HEIGHT_CHROME, true, 100), 1);
});
