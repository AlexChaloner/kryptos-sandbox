import { combineAlignedCipherText } from "./cipher.js?v=7";

export function normalizeOverlayLink(link) {
  if (!link) return null;
  return {
    ...link,
    operandAId: link.operandAId || link.overlayId,
    operandBId: link.operandBId || link.baseId,
    rowOffset: Number.isFinite(link.rowOffset) ? Math.round(link.rowOffset) : 0,
    columnOffset: Number.isFinite(link.columnOffset) ? Math.round(link.columnOffset) : 0,
    operation: link.operation || "add",
  };
}

export function normalizeOverlayLinks(links) {
  return (links || []).map(normalizeOverlayLink).filter(Boolean);
}

export function createOverlayLink({ id, baseId, overlayId, rowOffset, columnOffset, operation }) {
  return normalizeOverlayLink({
    id,
    baseId,
    overlayId,
    operandAId: overlayId,
    operandBId: baseId,
    rowOffset,
    columnOffset,
    operation,
  });
}

export function findOverlayLink(links, firstId, secondId) {
  if (!firstId || !secondId) return null;
  return (links || []).find(link =>
    (link.overlayId === firstId && link.baseId === secondId)
    || (link.overlayId === secondId && link.baseId === firstId)
  ) || null;
}

export function removeOverlayLinksForGrid(links, gridId) {
  return normalizeOverlayLinks(links).filter(link => link.baseId !== gridId && link.overlayId !== gridId);
}

export function removeCyclicOverlayLinks(links) {
  const accepted = [];
  const children = new Map();
  const canReach = (startId, targetId) => {
    const pending = [startId];
    const visited = new Set();
    while (pending.length) {
      const current = pending.pop();
      if (current === targetId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      (children.get(current) || []).forEach(child => pending.push(child));
    }
    return false;
  };
  normalizeOverlayLinks(links).forEach(link => {
    if (link.baseId === link.overlayId || canReach(link.overlayId, link.baseId)) return;
    accepted.push(link);
    if (!children.has(link.baseId)) children.set(link.baseId, []);
    children.get(link.baseId).push(link.overlayId);
  });
  return accepted;
}

export function resolveOverlayLink(link, grids, alphabet, operation = null) {
  const normalized = normalizeOverlayLink(link);
  if (!normalized) return null;
  const byId = grids instanceof Map ? grids : new Map((grids || []).map(grid => [grid.id, grid]));
  const base = byId.get(normalized.baseId);
  const overlay = byId.get(normalized.overlayId);
  const operandA = byId.get(normalized.operandAId);
  const operandB = byId.get(normalized.operandBId);
  if (!base || !overlay || !operandA || !operandB || base.id === overlay.id) return null;
  if (![operandA.id, operandB.id].includes(base.id) || ![operandA.id, operandB.id].includes(overlay.id)) return null;
  const alignment = {
    topOperand: overlay.id === operandA.id ? "a" : "b",
    rowOffset: normalized.rowOffset,
    columnOffset: normalized.columnOffset,
  };
  const resolvedOperation = operation || normalized.operation;
  const combined = combineAlignedCipherText(
    operandA,
    operandB,
    resolvedOperation,
    alphabet,
    alignment,
  );
  return { link: normalized, base, overlay, operandA, operandB, alignment, operation: resolvedOperation, combined };
}

export function alignmentFromCellGeometry({
  deltaX,
  deltaY,
  baseCellWidth,
  baseCellHeight,
  overlayCellWidth = baseCellWidth,
  overlayCellHeight = baseCellHeight,
  horizontalGap = 2,
  verticalGap = 2,
  minimumOverlap = 0.35,
}) {
  const strideX = baseCellWidth + horizontalGap;
  const strideY = baseCellHeight + verticalGap;
  if (![deltaX, deltaY, strideX, strideY, overlayCellWidth, overlayCellHeight].every(Number.isFinite)) return null;
  if (strideX <= 0 || strideY <= 0 || baseCellWidth <= 0 || baseCellHeight <= 0 || overlayCellWidth <= 0 || overlayCellHeight <= 0) return null;
  const columnOffset = Math.round(deltaX / strideX);
  const rowOffset = Math.round(deltaY / strideY);
  const residualX = deltaX - columnOffset * strideX;
  const residualY = deltaY - rowOffset * strideY;
  const overlapWidth = Math.max(0,
    Math.min(baseCellWidth, residualX + overlayCellWidth) - Math.max(0, residualX),
  );
  const overlapHeight = Math.max(0,
    Math.min(baseCellHeight, residualY + overlayCellHeight) - Math.max(0, residualY),
  );
  const minimumCellArea = Math.min(baseCellWidth * baseCellHeight, overlayCellWidth * overlayCellHeight);
  const overlapRatio = minimumCellArea ? overlapWidth * overlapHeight / minimumCellArea : 0;
  if (overlapRatio < minimumOverlap) return null;
  return { rowOffset, columnOffset, overlapRatio };
}

export function overlayPosition(base, link, cellSize, gap = 2, scale = 1) {
  const normalized = normalizeOverlayLink(link);
  const stride = (cellSize + gap) * scale;
  return {
    x: base.x + normalized.columnOffset * stride,
    y: base.y + normalized.rowOffset * stride,
  };
}
