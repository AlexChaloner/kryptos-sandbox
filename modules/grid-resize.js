const CELL_GAP = 2;

export function renderedTrackCount(sourceCount, expanded) {
  const count = Math.max(1, Math.round(Number(sourceCount) || 1));
  return expanded ? count * 2 - 1 : count;
}

export function sourceCountFromRenderedExtent(extent, cellSize, chromeSize, expanded, maximum = 500) {
  const stride = Math.max(1, Number(cellSize) || 1) + CELL_GAP;
  const displayedCount = (Number(extent) - (Number(chromeSize) - CELL_GAP)) / stride;
  const sourceCount = expanded ? (displayedCount + 1) / 2 : displayedCount;
  return Math.min(Math.max(1, Math.round(sourceCount)), Math.max(1, Math.round(maximum)));
}
