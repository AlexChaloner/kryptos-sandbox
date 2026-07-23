export const GRID_CELL_GAP = 2;
export const GRID_WIDTH_CHROME = 20;
export const GRID_HEIGHT_CHROME = 54;
export const DIFFERENCE_CELL_RATIO = 0.7;

function scoreIsBetter(candidate, current) {
  for (let index = 0; index < candidate.length; index++) {
    if (candidate[index] !== current[index]) return candidate[index] < current[index];
  }
  return false;
}

export function renderedTrackCount(sourceCount, expanded) {
  const count = Math.max(1, Math.round(Number(sourceCount) || 1));
  return expanded ? count * 2 - 1 : count;
}

export function resizeAxisForMovement(deltaX, deltaY) {
  return Math.abs(Number(deltaX) || 0) >= Math.abs(Number(deltaY) || 0) ? "width" : "height";
}

export function differenceCellSize(cellSize) {
  return Math.max(1, Number(cellSize) || 1) * DIFFERENCE_CELL_RATIO;
}

export function gridTrackSizes(sourceCount, cellSize, expanded) {
  const count = Math.max(1, Math.round(Number(sourceCount) || 1));
  const sourceSize = Math.max(1, Number(cellSize) || 1);
  if (!expanded) return Array(count).fill(sourceSize);
  const differenceSize = differenceCellSize(sourceSize);
  return Array.from({ length: renderedTrackCount(count, true) }, (_, index) => index % 2 ? differenceSize : sourceSize);
}

export function gridAxisExtent(sourceCount, cellSize, chromeSize, expanded = false) {
  const count = Math.max(1, Math.round(Number(sourceCount) || 1));
  const sourceSize = Math.max(1, Number(cellSize) || 1);
  if (!expanded) return Number(chromeSize) + count * sourceSize + Math.max(0, count - 1) * GRID_CELL_GAP;
  const differenceSize = differenceCellSize(sourceSize);
  return Number(chromeSize)
    + count * sourceSize
    + Math.max(0, count - 1) * differenceSize
    + Math.max(0, count * 2 - 2) * GRID_CELL_GAP;
}

export function sourceCountFromRenderedExtent(extent, cellSize, chromeSize, expanded, maximum = 500) {
  const sourceSize = Math.max(1, Number(cellSize) || 1);
  const differenceSize = differenceCellSize(sourceSize);
  const stride = expanded ? sourceSize + differenceSize + GRID_CELL_GAP * 2 : sourceSize + GRID_CELL_GAP;
  const offset = expanded ? differenceSize + GRID_CELL_GAP * 2 : GRID_CELL_GAP;
  const sourceCount = (Number(extent) - Number(chromeSize) + offset) / stride;
  return Math.min(Math.max(1, Math.round(sourceCount)), Math.max(1, Math.round(maximum)));
}

export function gridGeometry({
  textLength = 0,
  columns = 1,
  cellSize = 28,
  horizontalDifferences = false,
  verticalDifferences = false,
  sourceWidth,
  sourceHeight,
} = {}) {
  const sourceColumns = Math.max(1, Math.round(Number(columns) || 1));
  const sourceRows = Math.max(1, Math.ceil(Math.max(0, Number(textLength) || 0) / sourceColumns));
  const displayColumns = renderedTrackCount(sourceColumns, horizontalDifferences);
  const displayRows = renderedTrackCount(sourceRows, verticalDifferences);
  const fittedSourceWidth = gridAxisExtent(sourceColumns, cellSize, GRID_WIDTH_CHROME);
  const fittedSourceHeight = gridAxisExtent(sourceRows, cellSize, GRID_HEIGHT_CHROME);
  const storedSourceWidth = Number.isFinite(Number(sourceWidth)) ? Math.max(0, Number(sourceWidth)) : fittedSourceWidth;
  const storedSourceHeight = Number.isFinite(Number(sourceHeight)) ? Math.max(0, Number(sourceHeight)) : fittedSourceHeight;
  const displayWidth = gridAxisExtent(sourceColumns, cellSize, GRID_WIDTH_CHROME, horizontalDifferences);
  const displayHeight = gridAxisExtent(sourceRows, cellSize, GRID_HEIGHT_CHROME, verticalDifferences);
  return {
    sourceColumns,
    sourceRows,
    displayColumns,
    displayRows,
    fittedSourceWidth,
    fittedSourceHeight,
    renderedWidth: horizontalDifferences ? Math.max(storedSourceWidth, displayWidth) : storedSourceWidth,
    renderedHeight: verticalDifferences ? Math.max(storedSourceHeight, displayHeight) : storedSourceHeight,
  };
}

export function closestColumnsForRows(textLength, requestedRows, preferredColumns, maximum = 500) {
  const length = Math.max(0, Math.floor(Number(textLength) || 0));
  const limit = Math.max(1, Math.round(Number(maximum) || 1));
  const preferred = Math.min(Math.max(1, Math.round(Number(preferredColumns) || 1)), limit);
  const targetRows = Math.max(1, Math.round(Number(requestedRows) || 1));
  const preferredRows = Math.max(1, Math.ceil(length / preferred));
  const direction = Math.sign(targetRows - preferredRows);
  let best = preferred;
  let bestScore = [Math.abs(preferredRows - targetRows), 0, 0];
  for (let columns = 1; columns <= limit; columns++) {
    const rows = Math.max(1, Math.ceil(length / columns));
    const wrongDirection = (direction > 0 && columns > preferred) || (direction < 0 && columns < preferred) ? 1 : 0;
    const score = [Math.abs(rows - targetRows), wrongDirection, Math.abs(columns - preferred)];
    if (scoreIsBetter(score, bestScore)) {
      best = columns;
      bestScore = score;
    }
  }
  return best;
}

export function columnsForResizeDrag({
  startColumns = 1,
  textLength = 0,
  cellSize = 28,
  startWidth = 0,
  startHeight = 0,
  deltaX = 0,
  deltaY = 0,
  horizontalDifferences = false,
  verticalDifferences = false,
  maximumColumns = 500,
} = {}) {
  const axis = resizeAxisForMovement(deltaX, deltaY);
  if (axis === "width") {
    const minimumWidth = gridAxisExtent(1, cellSize, GRID_WIDTH_CHROME, horizontalDifferences);
    const targetWidth = Math.max(minimumWidth, Number(startWidth) + Number(deltaX));
    return {
      axis,
      columns: sourceCountFromRenderedExtent(
        targetWidth,
        cellSize,
        GRID_WIDTH_CHROME,
        horizontalDifferences,
        maximumColumns,
      ),
    };
  }
  const maximumRows = Math.max(1, Math.floor(Number(textLength) || 0));
  const minimumHeight = gridAxisExtent(1, cellSize, GRID_HEIGHT_CHROME, verticalDifferences);
  const targetHeight = Math.max(minimumHeight, Number(startHeight) + Number(deltaY));
  const requestedRows = sourceCountFromRenderedExtent(
    targetHeight,
    cellSize,
    GRID_HEIGHT_CHROME,
    verticalDifferences,
    maximumRows,
  );
  return {
    axis,
    columns: closestColumnsForRows(textLength, requestedRows, startColumns, maximumColumns),
  };
}
