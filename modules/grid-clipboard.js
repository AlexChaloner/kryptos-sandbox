function serializableGrid(grid) {
  return JSON.parse(JSON.stringify({ ...grid, selected: [...(grid.selected || [])] }));
}

export function createGridBundle(grids, selectedIds, overlays = []) {
  const selected = new Set(selectedIds);
  const bundledGrids = selectedIds
    .map(id => grids.find(grid => grid.id === id))
    .filter(Boolean)
    .map(serializableGrid);
  return {
    version: 1,
    grids: bundledGrids,
    overlays: overlays.filter(link => selected.has(link.baseId) && selected.has(link.overlayId)).map(link => ({ ...link })),
  };
}

export function instantiateGridBundle(bundle, options) {
  if (!bundle || !Array.isArray(bundle.grids) || !bundle.grids.length) return null;
  const valid = bundle.grids.filter(grid => grid?.text && Number.isFinite(Number(grid.cols)));
  if (!valid.length) return null;
  const minimumX = Math.min(...valid.map(grid => Number(grid.x) || 0));
  const minimumY = Math.min(...valid.map(grid => Number(grid.y) || 0));
  const idMap = new Map(valid.map(grid => [grid.id, options.idFactory()]));
  const grids = valid.map((source, index) => {
    const copy = serializableGrid(source);
    copy.id = idMap.get(source.id);
    copy.name = `${source.name || `Grid ${index + 1}`} copy`;
    copy.x = options.anchorX + (Number(source.x) || 0) - minimumX;
    copy.y = options.anchorY + (Number(source.y) || 0) - minimumY;
    copy.z = options.nextZ();
    copy.selected = [];
    copy.highlights = { ...(source.highlights || {}) };
    copy.syncSourceId = idMap.get(source.syncSourceId) || null;
    if (source.derived) {
      const baseId = idMap.get(source.derived.baseId);
      const overlayId = idMap.get(source.derived.overlayId);
      copy.derived = baseId && overlayId ? { ...source.derived, baseId, overlayId } : null;
    }
    return copy;
  });
  const overlays = (bundle.overlays || []).map(link => {
    const baseId = idMap.get(link.baseId);
    const overlayId = idMap.get(link.overlayId);
    if (!baseId || !overlayId) return null;
    return {
      ...link,
      id: options.idFactory("live-overlay"),
      baseId,
      overlayId,
      operandAId: idMap.get(link.operandAId) || overlayId,
      operandBId: idMap.get(link.operandBId) || baseId,
    };
  }).filter(Boolean);
  return { grids, overlays };
}
