export function scaleCanvasPositions(grids, previousZoom, nextZoom, anchor) {
  const ratio = nextZoom / previousZoom;
  const raw = grids.map(grid => ({
    id: grid.id,
    x: anchor.x + (grid.x - anchor.x) * ratio,
    y: anchor.y + (grid.y - anchor.y) * ratio,
  }));
  const minimumX = raw.length ? Math.min(...raw.map(position => position.x)) : 0;
  const minimumY = raw.length ? Math.min(...raw.map(position => position.y)) : 0;
  const shiftX = Math.max(0, -minimumX);
  const shiftY = Math.max(0, -minimumY);
  return {
    positions: raw.map(position => ({ ...position, x: position.x + shiftX, y: position.y + shiftY })),
    scrollAdjustment: { x: shiftX, y: shiftY },
  };
}
