import {
  KRYPTOS_ALPHABET, NORMAL_ALPHABET, K1_CIPHERTEXT, K2_CIPHERTEXT, K3_CIPHERTEXT, K4_CIPHERTEXT, GRID_OPERATIONS,
  K1_PLAINTEXT, K2_PLAINTEXT, K3_PLAINTEXT,
  KRYPTOS_LEFT_PLATE, KRYPTOS_LEFT_PLATE_COLUMNS, KRYPTOS_RIGHT_PLATE, KRYPTOS_RIGHT_PLATE_COLUMNS,
  cleanText, cleanUnique, positionalK4Cribs, randomEnglishBookSample, randomLetters, combineAlignedCipherText, combineCipherText,
  gridDifferenceLayout,
} from "./modules/cipher.js?v=10";
import {
  alignmentFromCellGeometry, compactSparseLayout, createOverlayLink, findOverlayLink, normalizeOverlayLinks,
  materializedOverlayLayout, overlayPosition, removeCyclicOverlayLinks, removeOverlayLinksForGrid, resolveOverlayLink,
} from "./modules/overlay.js?v=2";
import {
  letterCounts, indexOfCoincidence, frequencySimilarity, estimateNulls, formatPercent,
  scanVigenerePeriods, suggestVigenereKey, decryptVigenere, coincidenceSignificance, formatPValue,
} from "./modules/analysis.js";
import { uniqueId, clamp, escapeHtml } from "./modules/utils.js";
import { transformSparseIndex, transformSparseText } from "./modules/matrix.js?v=3";
import { createContextMenuController } from "./modules/context-menu.js";
import { scanModularRoutes, bestNgramRouteOffset } from "./modules/transposition-analysis.js";
import { scanGridDiagnostics, scanGridRoutes } from "./modules/grid-analysis.js";
import { readWorkspaceLibrary, writeWorkspaceLibrary } from "./modules/persistence.js";
import { createGridBundle, instantiateGridBundle } from "./modules/grid-clipboard.js";
import { scaleCanvasPositions } from "./modules/viewport.js";
import {
  GRID_HEIGHT_CHROME, GRID_WIDTH_CHROME, columnsForResizeDrag, differenceCellSize, gridAxisExtent, gridGeometry, gridTrackSizes,
} from "./modules/grid-resize.js?v=3";

(() => {
  "use strict";

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const workspace = $("#workspace");
  const { show: showContextMenu, close: closeContextMenu } = createContextMenuController($("#contextMenu"));
  let analysisPeriod = 1;
  let analysisSequenceSignature = "";
  let strideScan = null;
  let strideSelected = null;
  let strideSelectedRoute = "";
  let strideScanToken = 0;
  let strideScanTimer = null;
  let strideLastSignature = "";
  let gridDiagnosticScan = null;
  let gridDiagnosticFilter = "all";
  let gridDiagnosticSelectedId = null;
  let gridRouteScan = null;
  let gridRouteSelected = null;
  let gridShapeScanToken = 0;
  let gridShapeScanTimer = null;
  let gridShapeLastSignature = "";
  let copiedGridClipboard = null;
  let libraryEditorCommit = null;
  let liveOverlayPreviewSignature = "";
  let liveOverlayAnalysisPreview = null;
  let persistenceWarning = "";
  let analysisSignalSignature = "";
  let analysisBaseEvents = [];
  let compressionWorker = null;
  let compressionWorkerSignature = "";
  let compressionTimer = null;
  let compressionToken = 0;
  let appendTypingSession = null;
  let appendTypingTimer = null;
  let appendRenderFrame = null;
  let appendScrollGridId = null;
  const compressionCache = new Map();
  const STARTER_LIBRARY_VERSION = 1;
  const WORKSPACE_LIBRARY_KEY = "kryptos-workspace-library";
  const WORKSPACE_RECOVERY_KEY = "kryptos-workspace-library-recovery";
  const LEGACY_SNAPSHOT_KEY = "kryptos-sandbox-snapshot";
  const LETTER_COLOURS = new Set(["amber", "blue", "coral", "green", "violet", "rose", "cyan"]);
  const GRID_BUNDLE_MIME = "application/x-kryptos-grids";

  const state = {
    grids: [],
    overlays: [],
    selectedGridId: null,
    selectedGridIds: [],
    alphabet: KRYPTOS_ALPHABET,
    cellSize: 28,
    zoom: 1,
    z: 5,
    tool: "select",
    analysisFullGrid: true,
    selectionDrag: null,
    moving: null,
    history: [],
    future: [],
    restoringHistory: false,
    folders: [],
    workspaces: [],
    activeWorkspaceId: null,
    activeFolderId: null,
  };

  const samples = [
    {
      id: "k4-cipher",
      name: "K4 ciphertext",
      text: K4_CIPHERTEXT,
      cols: 14, cellSize: 27, x: 38, y: 42, width: 445, height: 265, color: "amber", selected: new Set()
    },
    {
      id: "key-fragment",
      name: "Key fragment / EAST",
      text: "EASTNORTHEASTBERLINCLOCKPALIMPSESTABSCISSA",
      cols: 7, cellSize: 29, x: 520, y: 77, width: 258, height: 252, color: "blue", selected: new Set()
    },
    {
      id: "working-strip",
      name: "Working strip 01",
      text: "BETWEENSUBTLESHADINGANDTHEABSENCEOFLIGHTLIESTHENUANCEOFIQLUSION",
      cols: 10, cellSize: 25, x: 245, y: 362, width: 332, height: 230, color: "coral", selected: new Set()
    }
  ];

  function currentGrid() {
    return state.grids.find(grid => grid.id === state.selectedGridId) || null;
  }

  function differenceModes(grid) {
    const legacy = grid?.differenceView;
    return {
      horizontal: Boolean(grid?.differenceHorizontal || legacy === "horizontal" || legacy === "both"),
      vertical: Boolean(grid?.differenceVertical || legacy === "vertical" || legacy === "both"),
    };
  }

  function hasDifferenceView(grid) {
    const modes = differenceModes(grid);
    return modes.horizontal || modes.vertical;
  }

  function differenceLayoutForGrid(grid) {
    return gridDifferenceLayout(grid.text, grid.cols, differenceModes(grid), state.alphabet);
  }

  function gridGeometryFor(grid) {
    const modes = differenceModes(grid);
    return gridGeometry({
      textLength: grid.text.length,
      columns: grid.cols,
      cellSize: grid.cellSize,
      horizontalDifferences: modes.horizontal,
      verticalDifferences: modes.vertical,
      sourceWidth: grid.width,
      sourceHeight: grid.height,
    });
  }

  function synchronizedRoot(grid) {
    let current = grid;
    const visited = new Set();
    while (current?.syncSourceId && !visited.has(current.id)) {
      visited.add(current.id);
      current = state.grids.find(item => item.id === current.syncSourceId) || current;
      if (!current.syncSourceId) break;
    }
    return current || grid;
  }

  function synchronizedGroup(grid) {
    const root = synchronizedRoot(grid);
    return state.grids.filter(item => synchronizedRoot(item)?.id === root.id);
  }

  function normalizedHighlights(grid) {
    const highlights = {};
    Object.entries(grid.highlights || {}).forEach(([rawIndex, colour]) => {
      const index = Number(rawIndex);
      if (Number.isInteger(index) && index >= 0 && index < grid.text.length && grid.text[index] !== " " && LETTER_COLOURS.has(colour)) {
        highlights[index] = colour;
      }
    });
    return highlights;
  }

  function refreshSynchronizedViews() {
    state.grids.forEach(grid => {
      if (!grid.syncSourceId) return;
      const source = synchronizedRoot(grid);
      if (!source || source.id === grid.id) return;
      grid.text = source.text;
      grid.selected = new Set([...grid.selected].filter(index => index < grid.text.length));
      grid.highlights = normalizedHighlights(grid);
    });
  }

  function synchronizeSelection(grid) {
    const selection = new Set(grid.selected);
    synchronizedGroup(grid).forEach(item => { item.selected = new Set(selection); });
    synchronizedGroup(grid).forEach(item => {
      const card = $(`.grid-card[data-id="${item.id}"]`, workspace);
      if (!card) return;
      $$(".letter-cell", card).forEach(cell => cell.classList.toggle("selected", selection.has(Number(cell.dataset.index))));
    });
  }

  function toast(message, duration = 1900) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("visible");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("visible"), duration);
  }

  function captureSnapshot() {
    return {
      grids: state.grids.map(grid => ({
        ...grid,
        derived: grid.derived ? { ...grid.derived, alignment: grid.derived.alignment ? { ...grid.derived.alignment } : null } : null,
        highlights: { ...(grid.highlights || {}) },
        selected: [...grid.selected],
      })),
      overlays: state.overlays.map(overlay => ({ ...overlay })),
      selectedGridId: state.selectedGridId,
      selectedGridIds: [...state.selectedGridIds],
      alphabet: state.alphabet,
      cellSize: state.cellSize,
      zoom: state.zoom,
      z: state.z,
      analysisFullGrid: state.analysisFullGrid,
      workspaceTitle: $("#workspaceTitle").textContent,
      preferences: {
        showIndices: $("#showIndices").checked,
        snapCombine: $("#snapCombine").checked,
        combineOperation: $("#combineOperation").value,
      }
    };
  }

  function commitHistory(before, label) {
    if (state.restoringHistory || !before) return;
    const after = captureSnapshot();
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    state.history.push({ snapshot: before, label });
    if (state.history.length > 100) state.history.shift();
    state.future = [];
    updateHistoryControls();
    scheduleLibraryPersistence();
  }

  function restoreSnapshot(snapshot) {
    state.restoringHistory = true;
    state.grids = snapshot.grids.map(grid => ({
      ...grid,
      // Older releases saved materialized live overlays as aligned derived grids.
      // Keep their stored cells but detach that obsolete relationship on restore.
      derived: grid.derived?.alignment ? null : grid.derived ? { ...grid.derived, alignment: null } : null,
      highlights: { ...(grid.highlights || {}) },
      selected: new Set(grid.selected || []),
    }));
    state.overlays = normalizeOverlayLinks(snapshot.overlays);
    state.selectedGridId = snapshot.selectedGridId;
    state.selectedGridIds = snapshot.selectedGridIds || (snapshot.selectedGridId ? [snapshot.selectedGridId] : []);
    state.alphabet = snapshot.alphabet;
    state.cellSize = snapshot.cellSize || 28;
    state.zoom = snapshot.zoom;
    state.z = snapshot.z;
    state.analysisFullGrid = snapshot.analysisFullGrid;
    $("#workspaceTitle").textContent = snapshot.workspaceTitle;
    $("#showIndices").checked = snapshot.preferences.showIndices;
    $("#snapCombine").checked = snapshot.preferences.snapCombine;
    $("#combineOperation").value = snapshot.preferences.combineOperation;
    const preset = state.alphabet === KRYPTOS_ALPHABET ? KRYPTOS_ALPHABET : state.alphabet === NORMAL_ALPHABET ? NORMAL_ALPHABET : "custom";
    $$("#alphabetPreset button").forEach(button => button.classList.toggle("active", button.dataset.alphabet === preset));
    $("#customAlphabet").classList.toggle("hidden", preset !== "custom");
    if (preset === "custom") $("#customAlphabet").value = state.alphabet;
    renderAll();
    state.restoringHistory = false;
    updateHistoryControls();
  }

  function undo() {
    const entry = state.history.pop();
    if (!entry) return toast("Nothing to undo");
    state.future.push({ snapshot: captureSnapshot(), label: entry.label });
    restoreSnapshot(entry.snapshot);
    toast(`Undo: ${entry.label}`);
    setStatus(`Undid ${entry.label}`);
    scheduleLibraryPersistence();
  }

  function redo() {
    const entry = state.future.pop();
    if (!entry) return toast("Nothing to redo");
    state.history.push({ snapshot: captureSnapshot(), label: entry.label });
    restoreSnapshot(entry.snapshot);
    toast(`Redo: ${entry.label}`);
    setStatus(`Redid ${entry.label}`);
    scheduleLibraryPersistence();
  }

  function updateHistoryControls() {
    $("#undoAction").disabled = state.history.length === 0;
    $("#redoAction").disabled = state.future.length === 0;
    $("#undoAction").title = state.history.length ? `Undo ${state.history.at(-1).label} (Ctrl/Cmd + Z)` : "Nothing to undo";
    $("#redoAction").title = state.future.length ? `Redo ${state.future.at(-1).label} (Ctrl/Cmd + Shift + Z)` : "Nothing to redo";
  }

  function cloneSerializable(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function emptyWorkspaceDocument(name) {
    const document = captureSnapshot();
    document.grids = [];
    document.overlays = [];
    document.selectedGridId = null;
    document.selectedGridIds = [];
    document.workspaceTitle = name;
    document.analysisFullGrid = true;
    return document;
  }

  function starterGrid(name, text, columns, y, z) {
    const grid = {
      id: uniqueId("starter-grid"), name, text, cols: columns, cellSize: 28,
      x: 38, y, width: 330, height: 220, selected: [], z,
    };
    fitGridCardToContent(grid);
    return grid;
  }

  function starterSolutionWorkspace(folderId, section, ciphertext, plaintext, columns, method) {
    const name = `${section} solution · ${method}`;
    const ciphertextGrid = starterGrid(`${section} ciphertext`, ciphertext, columns, 42, 1);
    const plaintextGrid = starterGrid(`${section} plaintext · ${method}`, plaintext, columns, ciphertextGrid.y + ciphertextGrid.height + 40, 2);
    const document = emptyWorkspaceDocument(name);
    document.grids = [ciphertextGrid, plaintextGrid];
    document.overlays = [];
    document.selectedGridId = ciphertextGrid.id;
    document.selectedGridIds = [ciphertextGrid.id];
    document.z = 2;
    return {
      id: uniqueId("workspace"), folderId, name, document, history: [], future: [],
      starterId: `${section.toLowerCase()}-solution`,
    };
  }

  function serializeWorkspaceLibrary() {
    return {
      folders: state.folders,
      workspaces: state.workspaces,
      activeWorkspaceId: state.activeWorkspaceId,
      activeFolderId: state.activeFolderId,
      starterVersion: STARTER_LIBRARY_VERSION,
    };
  }

  function upgradeWorkspaceLibrary(library) {
    if ((library.starterVersion || 0) >= STARTER_LIBRARY_VERSION) return library;
    library.folders ||= [];
    library.workspaces ||= [];

    const emptyPlaceholderNames = new Set(["K3 Reconstruction", "Berlin clock notes", "Vigenère experiments"]);
    library.workspaces = library.workspaces.filter(entry => {
      if (!emptyPlaceholderNames.has(entry.name)) return true;
      return Boolean(entry.document?.grids?.length || entry.document?.overlays?.length || entry.history?.length || entry.future?.length);
    });

    const usedFolderIds = new Set(library.workspaces.map(entry => entry.folderId));
    library.folders = library.folders.filter(folder => !["folder-classical", "folder-archive"].includes(folder.id) || usedFolderIds.has(folder.id));
    let solvedFolder = library.folders.find(folder => folder.id === "folder-solved");
    if (!solvedFolder) {
      solvedFolder = { id: "folder-solved", name: "Solved sections", open: true };
      library.folders.push(solvedFolder);
    }

    const starters = [
      ["K1", K1_CIPHERTEXT, K1_PLAINTEXT, 21, "PALIMPSEST"],
      ["K2", K2_CIPHERTEXT, K2_PLAINTEXT, 31, "ABSCISSA"],
      ["K3", K3_CIPHERTEXT, K3_PLAINTEXT, 21, "double rotation"],
    ];
    starters.forEach(specification => {
      const starterId = `${specification[0].toLowerCase()}-solution`;
      if (!library.workspaces.some(entry => entry.starterId === starterId || entry.name.startsWith(`${specification[0]} solution`))) {
        library.workspaces.push(starterSolutionWorkspace(solvedFolder.id, ...specification));
      }
    });

    if (!library.workspaces.some(entry => entry.id === library.activeWorkspaceId)) library.activeWorkspaceId = library.workspaces[0]?.id || null;
    const active = library.workspaces.find(entry => entry.id === library.activeWorkspaceId);
    if (active && !library.folders.some(folder => folder.id === library.activeFolderId)) library.activeFolderId = active.folderId;
    library.starterVersion = STARTER_LIBRARY_VERSION;
    return library;
  }

  function saveActiveWorkspaceState({ includeHistory = true } = {}) {
    if (!state.activeWorkspaceId) return;
    const workspaceEntry = state.workspaces.find(item => item.id === state.activeWorkspaceId);
    if (!workspaceEntry) return;
    workspaceEntry.name = $("#workspaceTitle").textContent;
    workspaceEntry.document = cloneSerializable(captureSnapshot());
    if (includeHistory) {
      workspaceEntry.history = cloneSerializable(state.history);
      workspaceEntry.future = cloneSerializable(state.future);
    }
  }

  function initializeWorkspaceLibrary() {
    state.folders = [
      { id: "folder-k4", name: "K4 experiments", open: true },
      { id: "folder-solved", name: "Solved sections", open: true },
    ];
    const activeId = uniqueId("workspace");
    state.activeWorkspaceId = activeId;
    state.activeFolderId = "folder-k4";
    state.workspaces = [
      { id: activeId, folderId: "folder-k4", name: $("#workspaceTitle").textContent, document: cloneSerializable(captureSnapshot()), history: [], future: [] },
      starterSolutionWorkspace("folder-solved", "K1", K1_CIPHERTEXT, K1_PLAINTEXT, 21, "PALIMPSEST"),
      starterSolutionWorkspace("folder-solved", "K2", K2_CIPHERTEXT, K2_PLAINTEXT, 31, "ABSCISSA"),
      starterSolutionWorkspace("folder-solved", "K3", K3_CIPHERTEXT, K3_PLAINTEXT, 21, "double rotation"),
    ];
    renderWorkspaceTree();
    scheduleLibraryPersistence();
  }

  function renderWorkspaceTree() {
    const tree = $("#workspaceTree");
    tree.innerHTML = state.folders.map(folder => {
      const documents = state.workspaces.filter(item => item.folderId === folder.id);
      return `
        <button class="tree-row folder${folder.open ? " open" : ""}" data-folder-id="${escapeHtml(folder.id)}">
          <span class="chevron">${folder.open ? "⌄" : "›"}</span><span class="folder-icon">▰</span><span>${escapeHtml(folder.name)}</span><span class="count">${documents.length}</span>
        </button>
        ${folder.open ? `<div class="tree-children" data-folder-drop="${escapeHtml(folder.id)}">
          ${documents.map(item => `<button class="tree-row document${item.id === state.activeWorkspaceId ? " active" : ""}" draggable="true" data-workspace-id="${escapeHtml(item.id)}" data-name="${escapeHtml(item.name)}"><span class="doc-icon">▦</span><span>${escapeHtml(item.name)}</span>${item.id === state.activeWorkspaceId ? '<span class="status-dot"></span>' : ""}</button>`).join("") || '<div class="tree-empty">Drop a workspace here</div>'}
        </div>` : ""}`;
    }).join("");
  }

  function switchWorkspace(id) {
    if (id === state.activeWorkspaceId) return;
    const target = state.workspaces.find(item => item.id === id);
    if (!target) return;
    saveActiveWorkspaceState();
    state.activeWorkspaceId = id;
    state.activeFolderId = target.folderId;
    state.history = cloneSerializable(target.history || []);
    state.future = cloneSerializable(target.future || []);
    restoreSnapshot(cloneSerializable(target.document || emptyWorkspaceDocument(target.name)));
    $("#workspaceTitle").textContent = target.name;
    renderWorkspaceTree();
    scheduleLibraryPersistence();
    toast(`Opened ${target.name}`);
  }

  function openLibraryEditor(label, value, commit) {
    const editor = $("#libraryEditor");
    $("#libraryEditorLabel").textContent = label;
    $("#libraryEditorInput").value = value;
    libraryEditorCommit = commit;
    editor.classList.remove("hidden");
    editor.scrollIntoView({ block: "nearest" });
    requestAnimationFrame(() => $("#libraryEditorInput").select());
  }

  function closeLibraryEditor() {
    $("#libraryEditor").classList.add("hidden");
    libraryEditorCommit = null;
  }

  function createWorkspace(folderId = state.activeFolderId || state.folders[0]?.id, proposedName = "Untitled workspace") {
    openLibraryEditor("New workspace", proposedName, name => {
      saveActiveWorkspaceState();
      const entry = { id: uniqueId("workspace"), folderId, name, document: emptyWorkspaceDocument(name), history: [], future: [] };
      state.workspaces.push(entry);
      const folder = state.folders.find(item => item.id === folderId);
      if (folder) folder.open = true;
      switchWorkspace(entry.id);
    });
  }

  function createFolder() {
    openLibraryEditor("New folder", "New folder", name => {
      const folder = { id: uniqueId("folder"), name, open: true };
      state.folders.push(folder);
      state.activeFolderId = folder.id;
      renderWorkspaceTree();
      scheduleLibraryPersistence();
    });
  }

  function renameWorkspaceEntry(entry) {
    openLibraryEditor("Rename workspace", entry.name, name => {
      entry.name = name;
      if (entry.id === state.activeWorkspaceId) $("#workspaceTitle").textContent = entry.name;
      if (entry.document) entry.document.workspaceTitle = entry.name;
      renderWorkspaceTree();
      scheduleLibraryPersistence();
    });
  }

  function renameFolder(folder) {
    openLibraryEditor("Rename folder", folder.name, name => {
      folder.name = name;
      renderWorkspaceTree();
      scheduleLibraryPersistence();
    });
  }

  function deleteWorkspaceEntry(entry) {
    if (state.workspaces.length === 1) return toast("At least one workspace must remain");
    const wasActive = entry.id === state.activeWorkspaceId;
    state.workspaces = state.workspaces.filter(item => item.id !== entry.id);
    if (wasActive) {
      state.activeWorkspaceId = null;
      switchWorkspace(state.workspaces[0].id);
    } else {
      renderWorkspaceTree();
      scheduleLibraryPersistence();
    }
  }

  let librarySaveTimer = null;
  function persistWorkspaceLibraryNow({ notify = true } = {}) {
    if (!state.activeWorkspaceId) return;
    clearTimeout(librarySaveTimer);
    librarySaveTimer = null;
    saveActiveWorkspaceState({ includeHistory: false });
    try { localStorage.removeItem(LEGACY_SNAPSHOT_KEY); } catch {}
    const result = writeWorkspaceLibrary({
      local: localStorage,
      session: sessionStorage,
      key: WORKSPACE_LIBRARY_KEY,
      recoveryKey: WORKSPACE_RECOVERY_KEY,
      library: serializeWorkspaceLibrary(),
    });
    const warning = result.storage === "session"
      ? "Browser storage is full · this tab has a refresh-safe recovery copy"
      : result.storage === "failed"
        ? "Workspace could not be saved · browser storage is unavailable"
        : "";
    if (warning && warning !== persistenceWarning && notify) toast(warning, 5200);
    if (warning && notify) setStatus(warning);
    if (notify || !warning) persistenceWarning = warning;
    return result;
  }

  function scheduleLibraryPersistence() {
    if (!state.activeWorkspaceId) return;
    clearTimeout(librarySaveTimer);
    librarySaveTimer = setTimeout(() => persistWorkspaceLibraryNow(), 120);
  }

  function loadWorkspaceLibrary() {
    try {
      const { raw } = readWorkspaceLibrary({
        local: localStorage,
        session: sessionStorage,
        key: WORKSPACE_LIBRARY_KEY,
        recoveryKey: WORKSPACE_RECOVERY_KEY,
      });
      if (!raw) return false;
      const parsedLibrary = JSON.parse(raw);
      const library = upgradeWorkspaceLibrary(parsedLibrary);
      if (!library.folders?.length || !library.workspaces?.length) return false;
      state.folders = library.folders;
      state.workspaces = library.workspaces;
      state.activeWorkspaceId = library.activeWorkspaceId || state.workspaces[0].id;
      const active = state.workspaces.find(item => item.id === state.activeWorkspaceId) || state.workspaces[0];
      state.activeWorkspaceId = active.id;
      state.activeFolderId = active.folderId;
      state.history = active.history || [];
      state.future = active.future || [];
      restoreSnapshot(active.document);
      renderWorkspaceTree();
      scheduleLibraryPersistence();
      return true;
    } catch { return false; }
  }

  function reconcileOverlayState() {
    const gridsById = new Map(state.grids.map(grid => [grid.id, grid]));
    const seenOverlayIds = new Set();
    state.overlays = normalizeOverlayLinks(state.overlays).filter(link => {
      if (!gridsById.has(link.baseId) || !gridsById.has(link.overlayId) || link.baseId === link.overlayId) return false;
      if (seenOverlayIds.has(link.overlayId)) return false;
      seenOverlayIds.add(link.overlayId);
      return true;
    });
    state.overlays = removeCyclicOverlayLinks(state.overlays);
    for (let pass = 0; pass < state.overlays.length; pass++) {
      state.overlays.forEach(link => {
        const base = gridsById.get(link.baseId);
        const overlay = gridsById.get(link.overlayId);
        if (!base || !overlay) return;
        const position = overlayPosition(base, link, state.cellSize, 2, state.zoom);
        overlay.x = Math.max(0, position.x);
        overlay.y = Math.max(0, position.y);
      });
    }
  }

  function renderAll() {
    migrateLegacyK4Imports();
    state.grids.forEach(grid => { grid.cellSize = state.cellSize; grid.highlights = normalizedHighlights(grid); });
    refreshSynchronizedViews();
    refreshDerivedGrids();
    refreshSynchronizedViews();
    reconcileOverlayState();
    $$(".grid-card", workspace).forEach(card => card.remove());
    state.grids.forEach(renderGrid);
    updateWorkspaceExtent();
    renderPersistentOverlays();
    $("#emptyState").classList.toggle("visible", state.grids.length === 0);
    updateInspector();
    updateStatus();
    applyZoom();
  }

  function updateWorkspaceExtent() {
    const margin = 176;
    const bounds = state.grids.reduce((maximum, grid) => {
      const geometry = gridGeometryFor(grid);
      return {
        right: Math.max(maximum.right, grid.x + geometry.renderedWidth * state.zoom),
        bottom: Math.max(maximum.bottom, grid.y + geometry.renderedHeight * state.zoom),
      };
    }, { right: 0, bottom: 0 });
    const layer = $(".workspace-grid", workspace);
    layer.style.width = `${Math.max(2400, workspace.clientWidth, Math.ceil(bounds.right + margin))}px`;
    layer.style.height = `${Math.max(1600, workspace.clientHeight, Math.ceil(bounds.bottom + margin))}px`;
  }

  function migrateLegacyK4Imports() {
    state.grids.forEach(grid => {
      if (grid.name === "K4 positional crib mask") {
        restorePositionalQuestionMarks(grid);
        if (grid.cols === 32) { grid.cols = 14; grid.width = 445; grid.height = Math.max(grid.height, 280); }
      }
      if (grid.name === "K4 ciphertext" && grid.cols === 32) {
        grid.cols = 14;
        grid.width = 445;
        grid.height = Math.max(grid.height, 280);
      }
    });
  }

  function restorePositionalQuestionMarks(grid) {
    if (grid.text.includes("?") || !grid.text.includes(" ")) return;
    const candidates = [];
    const queue = [{ text: positionalK4Cribs(), cols: 14 }];
    const seen = new Set();
    while (queue.length && candidates.length < 16) {
      const candidate = queue.shift();
      const key = `${candidate.cols}:${candidate.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
      ["left", "right", "transpose"].forEach(kind => {
        const transformed = transformSparseText(candidate.text, candidate.cols, kind);
        queue.push({ text: transformed.text, cols: transformed.columns });
      });
    }
    const signature = value => [...value]
      .map((letter, index) => /[A-Z]/.test(letter) ? `${index}:${letter}` : "")
      .filter(Boolean)
      .join("|");
    const currentSignature = signature(grid.text);
    const match = candidates.find(candidate => candidate.cols === grid.cols && candidate.text.length === grid.text.length && signature(candidate.text) === currentSignature);
    if (match) grid.text = match.text;
  }

  function gridDimensionsText(grid, layout) {
    const source = `${grid.cols} × ${Math.ceil(grid.text.length / grid.cols)}`;
    return hasDifferenceView(grid) ? `${source} → ${layout.columns} × ${layout.rows}` : source;
  }

  function renderLetterGridCells(grid, letterGrid, layout) {
    const modes = differenceModes(grid);
    const geometry = gridGeometryFor(grid);
    const columnSizes = gridTrackSizes(geometry.sourceColumns, grid.cellSize, modes.horizontal);
    const rowSizes = gridTrackSizes(geometry.sourceRows, grid.cellSize, modes.vertical);
    const differenceSize = differenceCellSize(grid.cellSize);
    letterGrid.style.gridTemplateColumns = columnSizes.map(size => `${size}px`).join(" ");
    letterGrid.style.gridTemplateRows = rowSizes.map(size => `${size}px`).join(" ");
    const fragment = document.createDocumentFragment();
    [...layout.text].forEach((letter, index) => {
      const cell = document.createElement("div");
      const isEmpty = !letter || letter === " ";
      const isUnknown = letter === "?";
      const sourceIndex = layout.sourceIndices[index];
      const kind = layout.kinds[index];
      const highlight = isEmpty || kind !== "source" ? null : grid.highlights?.[sourceIndex];
      const selected = Number.isInteger(sourceIndex) && grid.selected.has(sourceIndex);
      cell.className = `letter-cell${isEmpty ? " empty" : ""}${isUnknown ? " unknown" : ""}${kind === "horizontal" && !isEmpty ? " difference-cell difference-horizontal" : ""}${kind === "vertical" && !isEmpty ? " difference-cell difference-vertical" : ""}${highlight ? ` highlight-${highlight}` : ""}${selected ? " selected" : ""}`;
      if (Number.isInteger(sourceIndex)) cell.dataset.index = sourceIndex;
      cell.dataset.displayIndex = index;
      cell.dataset.kind = kind;
      const displayColumn = index % layout.columns;
      const displayRow = Math.floor(index / layout.columns);
      const isDifference = kind === "horizontal" || kind === "vertical";
      cell.style.width = `${isDifference ? differenceSize : columnSizes[displayColumn]}px`;
      cell.style.height = `${isDifference ? differenceSize : rowSizes[displayRow]}px`;
      cell.textContent = letter;
      if (layout.formulas[index]) cell.title = layout.formulas[index];
      if ($("#showIndices").checked && !isEmpty) {
        const alphabetIndex = state.alphabet.indexOf(letter);
        const value = alphabetIndex < 0 ? "–" : alphabetIndex;
        cell.insertAdjacentHTML("beforeend", `<span class="cell-index">${value}</span>`);
      }
      fragment.appendChild(cell);
    });
    letterGrid.replaceChildren(fragment);
  }

  function renderGrid(grid) {
    const card = document.createElement("article");
    const operandIndex = state.selectedGridIds.indexOf(grid.id);
    const showOperand = operandIndex >= 0 && state.selectedGridIds.length <= 2;
    const isOverlayTop = state.overlays.some(overlay => overlay.overlayId === grid.id);
    card.className = `grid-card${operandIndex >= 0 ? " selected" : ""}${grid.id === state.selectedGridId ? " primary" : ""}${isOverlayTop ? " overlay-top" : ""}${hasDifferenceView(grid) ? " difference-expanded" : ""}`;
    card.dataset.id = grid.id;
    if (showOperand) card.dataset.operand = String.fromCharCode(65 + operandIndex);
    const modes = differenceModes(grid);
    const difference = differenceLayoutForGrid(grid);
    const minimumWidth = grid.cellSize + 20;
    const contentHeight = gridMinimumHeight(grid);
    const minimumHeight = gridMinimumHeightForRows(grid, 1);
    grid.width = Math.max(grid.width, minimumWidth);
    grid.height = Math.max(grid.height, contentHeight);
    const geometry = gridGeometryFor(grid);
    card.style.cssText = `left:${grid.x}px;top:${grid.y}px;width:${geometry.renderedWidth}px;height:${geometry.renderedHeight}px;min-width:${minimumWidth}px;min-height:${minimumHeight}px;z-index:${grid.z || 1}`;
    card.innerHTML = `
      <div class="grid-card-header">
        <span class="grid-grip">⠿</span>
        <span class="grid-card-title">${escapeHtml(grid.name)}</span>
        ${grid.syncSourceId ? '<span class="sync-badge">SYNC</span>' : ""}
        ${(grid.derived || state.overlays.some(overlay => overlay.overlayId === grid.id)) ? '<span class="live-badge">LIVE</span>' : ""}
        ${modes.horizontal ? '<span class="difference-badge">ΔH</span>' : ""}
        ${modes.vertical ? '<span class="difference-badge vertical">ΔV</span>' : ""}
        <span class="grid-dimensions">${gridDimensionsText(grid, difference)}</span>
        <button class="grid-menu" title="Grid options">•••</button>
      </div>
      <div class="grid-card-body">
        <div class="letter-grid"></div>
      </div>
      <div class="grid-resize-handle" title="Resize and reshape grid" aria-label="Resize grid"></div>`;
    const letterGrid = $(".letter-grid", card);
    renderLetterGridCells(grid, letterGrid, difference);
    workspace.appendChild(card);

    card.addEventListener("pointerdown", event => {
      if (!event.target.closest(".letter-cell") && !event.target.closest(".grid-card-header")) selectGrid(grid.id, false, event.ctrlKey || event.metaKey);
    });
    $(".grid-resize-handle", card).addEventListener("pointerdown", event => beginGridResize(event, grid, card, letterGrid));
    $(".grid-card-header", card).addEventListener("pointerdown", event => beginMove(event, grid, card));
    letterGrid.addEventListener("pointerdown", event => beginCellSelection(event, grid, card));
    $(".grid-menu", card).addEventListener("click", event => {
      event.stopPropagation();
      selectGrid(grid.id);
      toast("Use the toolbar to transform or duplicate this grid");
    });

  }

  function beginGridResize(event, grid, card, letterGrid) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    selectGrid(grid.id, true);
    const before = captureSnapshot();
    const startGeometry = gridGeometryFor(grid);
    const start = {
      x: event.clientX,
      y: event.clientY,
      columns: grid.cols,
      width: startGeometry.renderedWidth,
      height: startGeometry.renderedHeight,
    };
    const modes = differenceModes(grid);
    const textLength = grid.text.length;
    let mode = null;
    let changed = false;
    card.classList.add("resizing");
    card.setPointerCapture?.(event.pointerId);

    const reshape = columns => {
      const nextColumns = clamp(columns, 1, 500);
      if (nextColumns === grid.cols) return;
      if (grid.syncSourceId) grid.syncSourceId = null;
      if (grid.derived) grid.derived = null;
      grid.cols = nextColumns;
      grid.width = gridWidthForColumns(grid, nextColumns);
      grid.height = gridMinimumHeight(grid);
      const layout = differenceLayoutForGrid(grid);
      const geometry = gridGeometryFor(grid);
      card.style.width = `${geometry.renderedWidth}px`;
      card.style.height = `${geometry.renderedHeight}px`;
      renderLetterGridCells(grid, letterGrid, layout);
      $(".grid-dimensions", card).textContent = gridDimensionsText(grid, layout);
      if (grid.id === state.selectedGridId) $("#gridColumns").value = grid.cols;
      updateWorkspaceExtent();
      setStatus(`Reshaped ${grid.name} to ${gridDimensionsText(grid, layout)}`);
      changed = true;
    };

    const move = moveEvent => {
      const dx = (moveEvent.clientX - start.x) / state.zoom;
      const dy = (moveEvent.clientY - start.y) / state.zoom;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
      const resize = columnsForResizeDrag({
        startColumns: start.columns,
        textLength,
        cellSize: grid.cellSize,
        startWidth: start.width,
        startHeight: start.height,
        deltaX: dx,
        deltaY: dy,
        horizontalDifferences: modes.horizontal,
        verticalDifferences: modes.vertical,
      });
      if (resize.axis !== mode) {
        mode = resize.axis;
        card.dataset.resizeMode = mode;
      }
      reshape(resize.columns);
    };

    const end = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      card.classList.remove("resizing");
      delete card.dataset.resizeMode;
      if (changed) {
        renderAll();
        commitHistory(before, `resize ${grid.name}`);
      }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end, { once: true });
    document.addEventListener("pointercancel", end, { once: true });
  }

  function selectGrid(id, preserveAnalysis = false, additive = false) {
    const alreadySelected = state.selectedGridIds.includes(id);
    let primaryId = id;
    if (additive) {
      if (alreadySelected && state.selectedGridIds.length > 1) {
        state.selectedGridIds = state.selectedGridIds.filter(gridId => gridId !== id);
        primaryId = state.selectedGridIds.at(-1);
      }
      else if (!alreadySelected) state.selectedGridIds = [...state.selectedGridIds, id];
    } else {
      state.selectedGridIds = [id];
    }
    state.selectedGridId = primaryId;
    const grid = currentGrid();
    if (grid) grid.z = ++state.z;
    if (!preserveAnalysis) state.analysisFullGrid = !grid?.selected.size;
    $$(".grid-card", workspace).forEach(card => {
      const index = state.selectedGridIds.indexOf(card.dataset.id);
      card.classList.toggle("selected", index >= 0);
      card.classList.toggle("primary", card.dataset.id === primaryId);
      if (index >= 0 && state.selectedGridIds.length <= 2) card.dataset.operand = String.fromCharCode(65 + index);
      else delete card.dataset.operand;
      if (card.dataset.id === primaryId) card.style.zIndex = grid.z;
    });
    updateInspector();
    updateStatus();
  }

  function beginMove(event, grid, card) {
    if (event.button !== 0 || state.tool === "pan") return;
    event.preventDefault();
    const historyBefore = captureSnapshot();
    selectGrid(grid.id, true, event.ctrlKey || event.metaKey);
    const start = {
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: workspace.scrollLeft,
      scrollTop: workspace.scrollTop,
      x: grid.x,
      y: grid.y,
    };
    let latestPointer = { clientX: event.clientX, clientY: event.clientY };
    state.moving = { grid, card, start };
    card.classList.add("dragging");
    card.setPointerCapture?.(event.pointerId);
    clearLiveOverlay(card);
    clearLiveOverlayAnalysisPreview(grid.id);

    let dragFrame = null;
    const updatePosition = (clientX, clientY, preview = true) => {
      const scrollDeltaX = workspace.scrollLeft - start.scrollLeft;
      const scrollDeltaY = workspace.scrollTop - start.scrollTop;
      grid.x = Math.max(0, Math.round((start.x + clientX - start.clientX + scrollDeltaX) / 8) * 8);
      grid.y = Math.max(0, Math.round((start.y + clientY - start.clientY + scrollDeltaY) / 8) * 8);
      card.style.left = `${grid.x}px`;
      card.style.top = `${grid.y}px`;
      updateWorkspaceExtent();
      if (!preview) return;
      const target = findOverlapTarget(grid, card);
      $$(".grid-card.preview-a, .grid-card.preview-b, .grid-card.drop-target", workspace).forEach(element => element.classList.remove("preview-a", "preview-b", "drop-target"));
      card.classList.add("preview-a");
      if (target) $(`.grid-card[data-id="${target.id}"]`, workspace)?.classList.add("preview-b");
      renderLiveOverlay(target, grid, card);
    };
    const schedulePositionUpdate = () => {
      if (dragFrame !== null) return;
      dragFrame = requestAnimationFrame(() => {
        dragFrame = null;
        updatePosition(latestPointer.clientX, latestPointer.clientY);
      });
    };
    const move = moveEvent => {
      latestPointer = { clientX: moveEvent.clientX, clientY: moveEvent.clientY };
      schedulePositionUpdate();
    };
    const scroll = schedulePositionUpdate;
    const end = endEvent => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      workspace.removeEventListener("scroll", scroll);
      if (dragFrame !== null) cancelAnimationFrame(dragFrame);
      dragFrame = null;
      if (Number.isFinite(endEvent?.clientX) && Number.isFinite(endEvent?.clientY)) {
        latestPointer = { clientX: endEvent.clientX, clientY: endEvent.clientY };
      }
      updatePosition(latestPointer.clientX, latestPointer.clientY, false);
      card.classList.remove("dragging");
      $$(".grid-card.preview-a, .grid-card.preview-b, .grid-card.drop-target", workspace).forEach(element => element.classList.remove("preview-a", "preview-b", "drop-target"));
      clearLiveOverlay(card);
      clearLiveOverlayAnalysisPreview(grid.id);
      if (endEvent?.type === "pointercancel") {
        state.moving = null;
        restoreSnapshot(historyBefore);
        setStatus(`Cancelled move of ${grid.name}`);
        return;
      }
      const target = endEvent?.type === "pointercancel" ? null : findOverlapTarget(grid, card);
      state.moving = null;
      if (target && $("#snapCombine").checked) {
        if (activateLiveOverlay(target, grid)) commitHistory(historyBefore, `overlay ${grid.name} on ${target.name}`);
        else {
          state.overlays = removeOverlayLinksForGrid(state.overlays, grid.id);
          renderAll();
          commitHistory(historyBefore, `move ${grid.name}`);
        }
      } else {
        const overlayCount = state.overlays.length;
        state.overlays = removeOverlayLinksForGrid(state.overlays, grid.id);
        if (overlayCount !== state.overlays.length) renderAll();
        else renderPersistentOverlays();
        commitHistory(historyBefore, `move ${grid.name}`);
        setStatus(`Moved ${grid.name}`);
      }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end, { once: true });
    document.addEventListener("pointercancel", end, { once: true });
    workspace.addEventListener("scroll", scroll, { passive: true });
  }

  function visibleGridBounds(card) {
    const body = $(".grid-card-body", card)?.getBoundingClientRect();
    const letters = $(".letter-grid", card)?.getBoundingClientRect();
    if (!body || !letters) return card.getBoundingClientRect();
    return {
      left: Math.max(body.left, letters.left),
      top: Math.max(body.top, letters.top),
      right: Math.min(body.right, letters.right),
      bottom: Math.min(body.bottom, letters.bottom),
    };
  }

  function findOverlapTarget(grid, card) {
    if (hasDifferenceView(grid)) return null;
    const a = visibleGridBounds(card);
    let best = null;
    let bestArea = 0;
    state.grids.forEach(candidate => {
      if (candidate.id === grid.id || hasDifferenceView(candidate)) return;
      const element = $(`.grid-card[data-id="${candidate.id}"]`, workspace);
      if (!element) return;
      const b = visibleGridBounds(element);
      const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const area = width * height;
      const threshold = Math.min(grid.cellSize, candidate.cellSize) ** 2 * .35 * state.zoom ** 2;
      if (area > threshold && area > bestArea) { best = candidate; bestArea = area; }
    });
    return best;
  }

  function clearLiveOverlay(scope = workspace) {
    liveOverlayPreviewSignature = "";
    $$(".letter-cell.live-overlay", scope).forEach(cell => {
      cell.classList.remove("live-overlay");
      delete cell.dataset.liveLetter;
      delete cell.dataset.liveFormula;
      cell.removeAttribute("title");
    });
  }

  function operationPresentation(a, b, operation, result) {
    if (operation === "reverseSubtract") {
      return { compact: `B:${b}−A:${a}`, title: `B: ${b} minus A: ${a} = ${result}` };
    }
    if (operation === "subtract") {
      return { compact: `A:${a}−B:${b}`, title: `A: ${a} minus B: ${b} = ${result}` };
    }
    return { compact: `A:${a}+B:${b}`, title: `A: ${a} plus B: ${b} = ${result}` };
  }

  function applyLiveOverlayResult(resolved, overlayCard) {
    const cells = $$(".letter-cell", overlayCard);
    resolved.combined.matches.forEach(match => {
      if (match.result === " ") return;
      const cell = cells[match.topIndex];
      if (!cell) return;
      const presentation = operationPresentation(match.a, match.b, resolved.operation, match.result);
      cell.dataset.liveLetter = match.result;
      cell.dataset.liveFormula = presentation.compact;
      cell.title = presentation.title;
      cell.classList.add("live-overlay");
    });
  }

  function overlayAnalysisLabel(operation) {
    if (operation === "subtract") return "A − B";
    if (operation === "reverseSubtract") return "B − A";
    return "A + B";
  }

  function setLiveOverlayAnalysisPreview(resolved, overlay) {
    const layout = materializedOverlayLayout(resolved.combined);
    liveOverlayAnalysisPreview = {
      id: `preview:${overlay.id}`,
      gridId: overlay.id,
      text: layout.text,
      cols: layout.columns,
      isOverlay: true,
      label: overlayAnalysisLabel(resolved.operation),
    };
    if ($("#analysisPanel").classList.contains("active")) updateAnalysis();
  }

  function clearLiveOverlayAnalysisPreview(gridId = null) {
    if (!liveOverlayAnalysisPreview || (gridId && liveOverlayAnalysisPreview.gridId !== gridId)) return;
    liveOverlayAnalysisPreview = null;
    if ($("#analysisPanel").classList.contains("active")) updateAnalysis();
  }

  function renderLiveOverlay(base, overlay, overlayCard) {
    if (hasDifferenceView(overlay)) {
      clearLiveOverlay(overlayCard);
      clearLiveOverlayAnalysisPreview(overlay.id);
      return;
    }
    if (!base) {
      if (liveOverlayPreviewSignature) clearLiveOverlay(overlayCard);
      clearLiveOverlayAnalysisPreview(overlay.id);
      return;
    }
    const baseCard = $(`.grid-card[data-id="${base.id}"]`, workspace);
    if (!baseCard) {
      clearLiveOverlay(overlayCard);
      clearLiveOverlayAnalysisPreview(overlay.id);
      return;
    }
    [$(".grid-card-body", baseCard), $(".grid-card-body", overlayCard)].forEach(body => {
      if (!body) return;
      body.scrollLeft = 0;
      body.scrollTop = 0;
    });
    const baseFirstCell = $(".letter-cell", baseCard);
    const overlayFirstCell = $(".letter-cell", overlayCard);
    if (!baseFirstCell || !overlayFirstCell) {
      clearLiveOverlay(overlayCard);
      clearLiveOverlayAnalysisPreview(overlay.id);
      return;
    }
    const baseFirstRect = baseFirstCell.getBoundingClientRect();
    const overlayFirstRect = overlayFirstCell.getBoundingClientRect();
    const deltaX = overlayFirstRect.left - baseFirstRect.left;
    const deltaY = overlayFirstRect.top - baseFirstRect.top;
    const alignment = alignmentFromCellGeometry({
      deltaX,
      deltaY,
      baseCellWidth: baseFirstRect.width,
      baseCellHeight: baseFirstRect.height,
      overlayCellWidth: overlayFirstRect.width,
      overlayCellHeight: overlayFirstRect.height,
      horizontalGap: 2 * state.zoom,
      verticalGap: 2 * state.zoom,
    });
    if (!alignment) {
      if (liveOverlayPreviewSignature) clearLiveOverlay(overlayCard);
      clearLiveOverlayAnalysisPreview(overlay.id);
      return;
    }
    const operation = $("#combineOperation").value;
    const signature = `${base.id}:${overlay.id}:${alignment.rowOffset}:${alignment.columnOffset}:${operation}:${state.alphabet}`;
    if (signature === liveOverlayPreviewSignature) return;
    clearLiveOverlay(overlayCard);
    liveOverlayPreviewSignature = signature;
    const previewLink = createOverlayLink({
      id: "preview",
      baseId: base.id,
      overlayId: overlay.id,
      rowOffset: alignment.rowOffset,
      columnOffset: alignment.columnOffset,
      operation,
    });
    const resolved = resolveOverlayLink(previewLink, [base, overlay], state.alphabet);
    if (resolved) {
      applyLiveOverlayResult(resolved, overlayCard);
      setLiveOverlayAnalysisPreview(resolved, overlay);
    } else clearLiveOverlayAnalysisPreview(overlay.id);
  }

  function activateLiveOverlay(base, overlay) {
    const stride = (state.cellSize + 2) * state.zoom;
    const snappedAlignment = alignmentFromCellGeometry({
      deltaX: overlay.x - base.x,
      deltaY: overlay.y - base.y,
      baseCellWidth: state.cellSize * state.zoom,
      baseCellHeight: state.cellSize * state.zoom,
      horizontalGap: 2 * state.zoom,
      verticalGap: 2 * state.zoom,
    });
    if (!snappedAlignment) {
      toast("Move the letter cells a little closer before linking them");
      return false;
    }
    let { columnOffset, rowOffset } = snappedAlignment;
    if (base.x + columnOffset * stride < 0) columnOffset = Math.ceil(-base.x / stride);
    if (base.y + rowOffset * stride < 0) rowOffset = Math.ceil(-base.y / stride);
    overlay.x = base.x + columnOffset * stride;
    overlay.y = base.y + rowOffset * stride;
    overlay.z = ++state.z;
    state.selectedGridIds = [overlay.id, base.id];
    state.selectedGridId = overlay.id;
    const nextLink = createOverlayLink({
      id: uniqueId("live-overlay"),
      baseId: base.id,
      overlayId: overlay.id,
      rowOffset,
      columnOffset,
      operation: $("#combineOperation").value,
    });
    const resolved = resolveOverlayLink(nextLink, [base, overlay], state.alphabet);
    if (!resolved?.combined.combinedCount) {
      toast("Those cells overlap, but there are no letter pairs to combine");
      return false;
    }
    state.overlays = removeOverlayLinksForGrid(state.overlays, overlay.id);
    state.overlays.push(nextLink);
    renderAll();
    setStatus(`Live overlay: ${resolved.combined.combinedCount} letters from ${resolved.combined.alignedCount} aligned cells`);
    toast(`A: ${overlay.name} · B: ${base.name}`);
    return true;
  }

  function renderPersistentOverlays() {
    state.overlays.forEach(link => {
      const resolved = resolveOverlayLink(link, state.grids, state.alphabet);
      if (!resolved) return;
      const { overlay } = resolved;
      const overlayCard = $(`.grid-card[data-id="${link.overlayId}"]`, workspace);
      if (!overlay || !overlayCard || hasDifferenceView(overlay)) return;
      applyLiveOverlayResult(resolved, overlayCard);
    });
  }

  function combinedText(base, overlay, operation) {
    return combineCipherText(base, overlay, operation, state.alphabet);
  }

  function overlayLinkForOperands(operandA, operandB) {
    return findOverlayLink(state.overlays, operandA?.id, operandB?.id);
  }

  function overlayLinkForGrid(gridId) {
    return [...state.overlays].reverse().find(link => link.baseId === gridId || link.overlayId === gridId) || null;
  }

  function activeOverlayLink(operands = state.selectedGridIds.map(id => state.grids.find(grid => grid.id === id)).filter(Boolean)) {
    if (operands.length > 2) return null;
    const selectedLink = overlayLinkForOperands(operands[0], operands[1]);
    if (selectedLink || operands.length >= 2) return selectedLink;
    return overlayLinkForGrid(state.selectedGridId);
  }

  function alignedCombination(link, operation) {
    const resolved = resolveOverlayLink(link, state.grids, state.alphabet, operation);
    if (!resolved) return null;
    const layout = materializedOverlayLayout(resolved.combined);
    return {
      ...resolved.combined,
      ...layout,
      alignment: resolved.alignment,
      operandA: resolved.operandA,
      operandB: resolved.operandB,
      layoutGrid: resolved.overlay,
    };
  }

  function refreshDerivedGrids() {
    state.grids.forEach(grid => {
      if (!grid.derived) return;
      const base = state.grids.find(item => item.id === grid.derived.baseId);
      const overlay = state.grids.find(item => item.id === grid.derived.overlayId);
      if (!base || !overlay) return;
      if (grid.derived.alignment) {
        const combined = combineAlignedCipherText(base, overlay, grid.derived.operation, state.alphabet, grid.derived.alignment);
        const layout = materializedOverlayLayout(combined, grid.derived.compact);
        grid.text = layout.text;
        grid.cols = layout.columns;
        delete grid.derived.alignment.columns;
      } else {
        const result = combinedText(base, overlay, grid.derived.operation);
        grid.text = grid.derived.compact ? result.replaceAll(" ", "") : result;
        grid.cols = Math.max(1, Math.min(base.cols, overlay.cols, grid.text.length || 1));
      }
      grid.cellSize = Math.min(base.cellSize, overlay.cellSize);
    });
  }

  function beginCellSelection(event, grid, card) {
    const cell = event.target.closest(".letter-cell");
    const anchor = Number(cell?.dataset.index);
    if (!cell || !Number.isInteger(anchor) || event.button !== 0 || state.tool !== "select") return;
    event.preventDefault();
    event.stopPropagation();
    const historyBefore = captureSnapshot();
    selectGrid(grid.id, true);
    const rectangular = event.ctrlKey || event.metaKey;
    const base = rectangular ? new Set(grid.selected) : new Set();
    if (!rectangular) grid.selected.clear();
    state.selectionDrag = { grid, anchor, rectangular, base };
    grid.selectionOrientation = "horizontal";
    updateStripSelection(anchor);

    const move = moveEvent => {
      const under = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest(".letter-cell");
      if (!under || !card.contains(under)) return;
      state.selectionDrag.rectangular = moveEvent.ctrlKey || moveEvent.metaKey || rectangular;
      updateStripSelection(Number(under.dataset.index));
    };
    const end = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      $$(".letter-cell.anchor", workspace).forEach(cell => cell.classList.remove("anchor"));
      state.selectionDrag = null;
      state.analysisFullGrid = false;
      updateInspector();
      updateStatus();
      commitHistory(historyBefore, `select cells in ${grid.name}`);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end, { once: true });
  }

  function updateStripSelection(current) {
    const drag = state.selectionDrag;
    if (!drag) return;
    const { grid, anchor, rectangular, base } = drag;
    grid.selected = new Set(base);
    if (rectangular) {
      const startRow = Math.min(Math.floor(anchor / grid.cols), Math.floor(current / grid.cols));
      const endRow = Math.max(Math.floor(anchor / grid.cols), Math.floor(current / grid.cols));
      const startColumn = Math.min(anchor % grid.cols, current % grid.cols);
      const endColumn = Math.max(anchor % grid.cols, current % grid.cols);
      for (let row = startRow; row <= endRow; row++) {
        for (let column = startColumn; column <= endColumn; column++) {
        const index = row * grid.cols + column;
        if (index < grid.text.length) grid.selected.add(index);
        }
      }
    } else {
      for (let index = Math.min(anchor, current); index <= Math.max(anchor, current); index++) grid.selected.add(index);
    }
    const card = $(`.grid-card[data-id="${grid.id}"]`, workspace);
    $$(".letter-cell", card).forEach(element => element.classList.toggle("selected", grid.selected.has(Number(element.dataset.index))));
    synchronizeSelection(grid);
    $$(".letter-cell.anchor", workspace).forEach(cell => cell.classList.remove("anchor"));
    cellAt(card, anchor)?.classList.add("anchor");
    updateAnalysis();
    updateStatus();
  }

  function cellAt(card, index) {
    return $(`.letter-cell[data-index="${index}"][data-kind="source"]`, card)
      || $(`.letter-cell[data-index="${index}"]`, card);
  }

  function gridMinimumHeight(grid) {
    const rows = Math.max(1, Math.ceil(grid.text.length / grid.cols));
    return gridMinimumHeightForRows(grid, rows);
  }

  function gridMinimumHeightForRows(grid, rows) {
    return gridAxisExtent(rows, grid.cellSize, GRID_HEIGHT_CHROME);
  }

  function gridWidthForColumns(grid, columns) {
    return gridAxisExtent(columns, grid.cellSize, GRID_WIDTH_CHROME);
  }

  function fitGridCardToContent(grid) {
    grid.width = gridWidthForColumns(grid, grid.cols);
    grid.height = gridMinimumHeight(grid);
  }

  function compactSelectedGrid() {
    const grid = currentGrid();
    if (!grid) return toast("Select a grid first");
    if (!grid.text.includes(" ")) return toast(`${grid.name} is already compact`);
    const before = captureSnapshot();
    let preferredColumns = grid.cols;
    if (grid.derived?.alignment) {
      const operandA = state.grids.find(item => item.id === grid.derived.baseId);
      const operandB = state.grids.find(item => item.id === grid.derived.overlayId);
      if (operandA && operandB) {
        preferredColumns = combineAlignedCipherText(
          operandA,
          operandB,
          grid.derived.operation,
          state.alphabet,
          grid.derived.alignment,
        ).overlapColumns;
      }
    }
    const compacted = compactSparseLayout(grid.text, grid.cols, preferredColumns);
    grid.selected = new Set([...grid.selected].map(index => compacted.indexMap[index]).filter(index => index >= 0));
    grid.highlights = Object.fromEntries(Object.entries(grid.highlights || {})
      .map(([index, colour]) => [compacted.indexMap[Number(index)], colour])
      .filter(([index]) => index >= 0));
    if (grid.syncSourceId) grid.syncSourceId = null;
    if (grid.derived) grid.derived.compact = true;
    grid.text = compacted.text;
    grid.cols = compacted.columns;
    fitGridCardToContent(grid);
    renderAll();
    commitHistory(before, `compact ${grid.name}`);
    toast(`Compacted ${grid.name} to ${grid.text.length} letters`);
  }

  function combineGrids(selectedA, selectedB) {
    const alphabet = state.alphabet;
    if (alphabet.length < 2) return toast("Choose an alphabet with at least two unique symbols");
    const link = overlayLinkForOperands(selectedA, selectedB);
    const operation = link?.operation || $("#combineOperation").value;
    const definition = GRID_OPERATIONS[operation] || GRID_OPERATIONS.add;
    const flatText = link ? null : combinedText(selectedA, selectedB, operation);
    const combined = link
      ? alignedCombination(link, operation)
      : {
        text: flatText,
        columns: Math.max(1, Math.min(selectedA.cols, selectedB.cols, flatText.length || 1)),
        alignedCount: Math.min(selectedA.text.length, selectedB.text.length),
        alignment: null,
      };
    if (!combined) return toast("That live overlay is no longer valid");
    const operandA = combined.operandA || selectedA;
    const operandB = combined.operandB || selectedB;
    const layoutGrid = combined.layoutGrid || null;
    const resultWidth = link ? gridWidthForColumns(layoutGrid, combined.columns) : Math.max(220, Math.min(operandA.width, operandB.width));
    const resultRows = Math.max(1, Math.ceil(combined.text.length / combined.columns));
    const resultHeight = link ? gridMinimumHeightForRows(layoutGrid, resultRows) : Math.max(150, Math.min(operandA.height, operandB.height));
    const resultPosition = positionInsideViewport(
      resultWidth,
      resultHeight,
      Math.round((Math.max(operandA.x, operandB.x) + 24) / 8) * 8,
      Math.round((Math.max(operandA.y, operandB.y) + 48) / 8) * 8,
    );
    const resultName = definition.reverseOperands
      ? `${operandB.name} ${definition.symbol} ${operandA.name}`
      : `${operandA.name} ${definition.symbol} ${operandB.name}`;
    const result = {
      id: uniqueId("operation"), name: resultName,
      text: combined.text, cols: combined.columns, cellSize: Math.min(operandA.cellSize, operandB.cellSize),
      x: resultPosition.x,
      y: resultPosition.y,
      width: resultWidth, height: resultHeight,
      selected: new Set(), highlights: {}, z: ++state.z,
      // Materializing a live overlay is a frozen snapshot. Flat A/B combinations
      // intentionally remain derived and continue following their operands.
      derived: link ? null : { baseId: operandA.id, overlayId: operandB.id, operation, alignment: null, compact: false }
    };
    state.grids.push(result);
    state.selectedGridId = result.id;
    state.selectedGridIds = [result.id];
    renderAll();
    $(`.grid-card[data-id="${result.id}"]`, workspace)?.classList.add("combine-flash");
    setStatus(`${link ? "Materialized" : "Combined"} ${combined.combinedCount ?? combined.alignedCount} letters: ${definition.label}`);
    toast(`Created ${result.name}${link ? " · independent snapshot" : ""}`);
  }

  function positionInsideViewport(width, height, preferredX = null, preferredY = null) {
    const padding = 24;
    const cascade = (state.grids.length % 7) * 24;
    const minimumX = workspace.scrollLeft + padding;
    const minimumY = workspace.scrollTop + padding;
    const maximumX = Math.max(minimumX, workspace.scrollLeft + workspace.clientWidth - width * state.zoom - padding);
    const maximumY = Math.max(minimumY, workspace.scrollTop + workspace.clientHeight - height * state.zoom - padding);
    const proposedX = preferredX ?? minimumX + cascade;
    const proposedY = preferredY ?? minimumY + cascade;
    return {
      x: Math.round(clamp(proposedX, minimumX, maximumX) / 8) * 8,
      y: Math.round(clamp(proposedY, minimumY, maximumY) / 8) * 8,
    };
  }

  function addGrid(text = "KRYPTOS", name = null, options = {}) {
    const historyBefore = options.skipHistory ? null : captureSnapshot();
    const index = state.grids.length + 1;
    const cleaned = (options.preserveSparse ? String(text || "").toUpperCase().replace(/[^A-Z? ]/g, "") : cleanText(text)) || "KRYPTOS";
    const width = options.width || 330;
    const height = options.height || 220;
    const position = positionInsideViewport(width, height, options.x, options.y);
    const grid = {
      id: uniqueId(), name: name || `Untitled grid ${index}`, text: cleaned,
      cols: options.cols || Math.min(10, Math.max(1, cleaned.length)), cellSize: 28,
      x: position.x, y: position.y, width, height,
      selected: new Set(), highlights: {}, z: ++state.z
    };
    if (options.fitContent) {
      fitGridCardToContent(grid);
      const fittedPosition = positionInsideViewport(grid.width, grid.height, options.x, options.y);
      grid.x = fittedPosition.x;
      grid.y = fittedPosition.y;
    }
    state.grids.push(grid);
    state.selectedGridId = grid.id;
    state.selectedGridIds = [grid.id];
    renderAll();
    setStatus(`Created ${grid.name}`);
    commitHistory(historyBefore, `create ${grid.name}`);
    return grid;
  }

  let cloneExtendSourceId = null;

  function cloneExtendText(sourceGrid) {
    return sourceGrid.selected.size
      ? orderedSelectionIndices(sourceGrid).map(index => sourceGrid.text[index]).join("")
      : sourceGrid.text.replaceAll(" ", "");
  }

  function closeCloneExtend() {
    $("#cloneExtendPopover").classList.add("hidden");
    $("#cloneExtend").classList.remove("active");
    cloneExtendSourceId = null;
  }

  function updateCloneExtendPreview() {
    const sourceGrid = state.grids.find(grid => grid.id === cloneExtendSourceId);
    if (!sourceGrid) return;
    const sourceText = cloneExtendText(sourceGrid);
    const repetitions = Number.parseInt($("#repeatCount").value, 10);
    $("#repeatCountValue").textContent = `${repetitions}×`;
    $("#repeatPreview").textContent = `${sourceText.length} source letters → ${sourceText.length * repetitions} letters`;
  }

  function openCloneExtend() {
    const sourceGrid = currentGrid();
    if (!sourceGrid) return toast("Select a source grid first");
    const sourceText = cloneExtendText(sourceGrid);
    if (!sourceText.length) return toast("The selected source contains no text");
    cloneExtendSourceId = sourceGrid.id;
    $("#repeatCount").value = String(clamp(Math.ceil(97 / sourceText.length), 2, 100));
    $("#cloneExtendPopover").classList.remove("hidden");
    $("#cloneExtend").classList.add("active");
    updateCloneExtendPreview();
  }

  function cloneAndExtend(repetitions) {
    const sourceGrid = state.grids.find(grid => grid.id === cloneExtendSourceId);
    if (!sourceGrid) return closeCloneExtend();
    const sourceText = cloneExtendText(sourceGrid);
    const result = sourceText.repeat(repetitions);
    closeCloneExtend();
    addGrid(result, `${sourceGrid.name} × ${repetitions}`, {
      cols: sourceGrid.cols,
      width: sourceGrid.width,
      height: Math.max(sourceGrid.height, 180),
    });
    setStatus(`Extended ${sourceText.length} characters to ${result.length}`);
  }

  function createSynchronizedView() {
    const selected = currentGrid();
    if (!selected) return toast("Select a source grid first");
    const source = synchronizedRoot(selected);
    const columns = selected.cols;
    const before = captureSnapshot();
    const position = positionInsideViewport(280, 180, selected.x + 40, selected.y + 40);
    const view = {
      id: uniqueId("sync-view"),
      name: `${source.name} · synchronized view`,
      text: source.text,
      cols: columns,
      cellSize: state.cellSize,
      x: position.x,
      y: position.y,
      width: 280,
      height: 180,
      selected: new Set(selected.selected),
      highlights: { ...(selected.highlights || {}) },
      selectionOrientation: selected.selectionOrientation || "horizontal",
      syncSourceId: source.id,
      syncRoute: "row-major",
      z: ++state.z,
    };
    fitGridCardToContent(view);
    state.grids.push(view);
    state.selectedGridId = view.id;
    state.selectedGridIds = [view.id];
    renderAll();
    commitHistory(before, `create synchronized view of ${source.name}`);
    toast("Created synchronized view");
  }

  function duplicateGrid(source = currentGrid()) {
    if (!source) return;
    const historyBefore = captureSnapshot();
    const position = positionInsideViewport(source.width, source.height, source.x + 32, source.y + 32);
    const copy = { ...source, id: uniqueId(), name: `${source.name} copy`, x: position.x, y: position.y, highlights: { ...(source.highlights || {}) }, selected: new Set(), z: ++state.z };
    if (copy.derived) copy.derived = { ...copy.derived, alignment: copy.derived.alignment ? { ...copy.derived.alignment } : null };
    if (copy.syncSourceId && !state.grids.some(grid => grid.id === copy.syncSourceId)) copy.syncSourceId = null;
    if (copy.derived && (!state.grids.some(grid => grid.id === copy.derived.baseId) || !state.grids.some(grid => grid.id === copy.derived.overlayId))) copy.derived = null;
    state.grids.push(copy);
    state.selectedGridId = copy.id;
    state.selectedGridIds = [copy.id];
    renderAll();
    commitHistory(historyBefore, `duplicate ${source.name}`);
    toast("Grid duplicated");
    return copy;
  }

  function deleteGrid() {
    const grid = currentGrid();
    if (!grid) return;
    const historyBefore = captureSnapshot();
    state.grids.forEach(item => { if (item.syncSourceId === grid.id) item.syncSourceId = null; });
    const removedIds = new Set([grid.id]);
    let foundDependent = true;
    while (foundDependent) {
      foundDependent = false;
      state.grids.forEach(item => {
        if (!item.derived || removedIds.has(item.id)) return;
        if (removedIds.has(item.derived.baseId) || removedIds.has(item.derived.overlayId)) {
          removedIds.add(item.id);
          foundDependent = true;
        }
      });
    }
    state.grids = state.grids.filter(item => !removedIds.has(item.id));
    state.overlays = state.overlays.filter(overlay => !removedIds.has(overlay.baseId) && !removedIds.has(overlay.overlayId));
    state.selectedGridId = state.grids.at(-1)?.id || null;
    state.selectedGridIds = state.selectedGridId ? [state.selectedGridId] : [];
    renderAll();
    commitHistory(historyBefore, `delete ${grid.name}`);
    toast(`Deleted ${grid.name}`);
  }

  function transformHighlights(grid, transformed, kind) {
    const highlights = {};
    Object.entries(grid.highlights || {}).forEach(([rawIndex, colour]) => {
      const index = Number(rawIndex);
      const target = transformSparseIndex(index, grid.text.length, grid.cols, kind);
      if (target >= 0 && target < transformed.text.length && transformed.text[target] !== " ") highlights[target] = colour;
    });
    return highlights;
  }

  function transformGrid(kind) {
    const grid = currentGrid();
    if (!grid) return;
    const historyBefore = captureSnapshot();
    const detachedSynchronizedView = Boolean(grid.syncSourceId);
    if (detachedSynchronizedView) grid.syncSourceId = null;
    if (grid.derived) grid.derived = null;
    const selection = new Set([...grid.selected]
      .map(index => transformSparseIndex(index, grid.text.length, grid.cols, kind))
      .filter(index => index >= 0));
    const transformed = transformSparseText(grid.text, grid.cols, kind);
    grid.highlights = transformHighlights(grid, transformed, kind);
    grid.text = transformed.text;
    grid.cols = transformed.columns;
    fitGridCardToContent(grid);
    grid.selected = selection;
    if (!detachedSynchronizedView) synchronizedGroup(grid).forEach(item => { item.selected = new Set(selection); });
    renderAll();
    const verb = kind === "transpose" ? "transpose" : kind === "mirror" ? "mirror" : kind === "reflectVertical" ? "reflect vertically" : "rotate";
    const pastTense = kind === "transpose" ? "Transposed" : kind === "mirror" ? "Mirrored" : kind === "reflectVertical" ? "Reflected vertically" : "Rotated";
    commitHistory(historyBefore, `${verb} ${grid.name}`);
    toast(`${pastTense} ${grid.name}${detachedSynchronizedView ? " · synchronized link detached" : ""}`);
  }

  function updateInspector() {
    const grid = currentGrid();
    state.selectedGridIds = state.selectedGridIds.filter(id => state.grids.some(item => item.id === id));
    const selectedGrids = state.selectedGridIds.map(id => state.grids.find(item => item.id === id)).filter(Boolean);
    const selectedOperands = selectedGrids.length <= 2 ? selectedGrids : [];
    const link = selectedGrids.length <= 2 ? activeOverlayLink(selectedOperands) : null;
    const resolvedLink = link ? resolveOverlayLink(link, state.grids, state.alphabet) : null;
    const operands = resolvedLink ? [resolvedLink.operandA, resolvedLink.operandB] : selectedOperands;
    $("#operandA").textContent = operands[0]?.name || "Select first grid";
    $("#operandB").textContent = operands[1]?.name || "Select second grid";
    $("#runGridOperation").disabled = !resolvedLink && selectedOperands.length !== 2;
    $("#runGridOperation").textContent = resolvedLink
      ? "Create grid from live overlay"
      : "Create live result from A and B";
    $("#compactGrid").disabled = !grid?.text.includes(" ");
    if (grid?.derived) $("#combineOperation").value = grid.derived.operation;
    else if (resolvedLink) $("#combineOperation").value = resolvedLink.link.operation;
    const controls = [$("#gridName"), $("#gridColumns"), $("#cellSize"), $("#gridText")];
    controls.forEach(control => control.disabled = !grid);
    $("#gridName").value = grid?.name || "Select a grid";
    $("#gridColumns").value = grid?.cols || "";
    $("#cellSize").value = grid?.cellSize || "";
    $("#gridText").value = grid?.text || "";
    const canColour = Boolean(grid && [...grid.selected].some(index => grid.text[index] && grid.text[index] !== " "));
    $$(".letter-colour-button").forEach(button => { button.disabled = !canColour; });
    $$("#differenceView button").forEach(button => {
      const modes = differenceModes(grid);
      button.disabled = !grid;
      const active = Boolean(modes[button.dataset.differenceAxis]);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    updateAlphabetPreview();
    updateAnalysis();
  }

  function currentAnalysisLayout() {
    const grid = currentGrid();
    if (!grid) return null;
    if (hasDifferenceView(grid)) {
      const modes = differenceModes(grid);
      const difference = differenceLayoutForGrid(grid);
      const axes = modes.horizontal && modes.vertical ? "HORIZONTAL + VERTICAL" : modes.horizontal ? "HORIZONTAL" : "VERTICAL";
      return {
        id: `${grid.id}:difference:${modes.horizontal ? "h" : ""}${modes.vertical ? "v" : ""}:${state.alphabet}`,
        gridId: grid.id,
        text: difference.text,
        cols: difference.columns,
        sourceIndices: difference.sourceIndices,
        isOverlay: false,
        isDifference: true,
        label: `${axes} DIFFERENCES`,
      };
    }
    if (liveOverlayAnalysisPreview?.gridId === grid.id) return liveOverlayAnalysisPreview;
    const gridIsMoving = state.moving?.grid.id === grid.id;
    const link = !gridIsMoving ? [...state.overlays].reverse().find(item => item.overlayId === grid.id) : null;
    const resolved = link ? resolveOverlayLink(link, state.grids, state.alphabet) : null;
    if (resolved) {
      const layout = materializedOverlayLayout(resolved.combined);
      return {
        id: `overlay:${link.id}`,
        gridId: grid.id,
        text: layout.text,
        cols: layout.columns,
        isOverlay: true,
        label: overlayAnalysisLabel(resolved.operation),
      };
    }
    return {
      id: grid.id,
      gridId: grid.id,
      text: grid.text,
      cols: grid.cols,
      isOverlay: false,
      isDifference: false,
      label: "",
    };
  }

  function selectedSequence(layout = currentAnalysisLayout()) {
    const grid = currentGrid();
    if (!grid || !layout) return "";
    if (!grid.selected.size) return layout.text;
    if (layout.sourceIndices) {
      const indices = [...layout.text]
        .map((_, index) => grid.selected.has(layout.sourceIndices[index]) ? index : null)
        .filter(Number.isInteger);
      if (grid.selectionOrientation === "vertical") {
        const rows = Math.ceil(layout.text.length / layout.cols);
        indices.sort((a, b) => (a % layout.cols) * rows + Math.floor(a / layout.cols)
          - ((b % layout.cols) * rows + Math.floor(b / layout.cols)));
      }
      return indices.map(index => layout.text[index]).join("");
    }
    return orderedSelectionIndices(grid, layout.cols, layout.text.length).map(index => layout.text[index]).join("");
  }

  function orderedSelectionIndices(grid, columns = grid.cols, textLength = grid.text.length) {
    const indices = [...grid.selected];
    if (grid.selectionOrientation !== "vertical") return indices.sort((a, b) => a - b);
    const rows = Math.ceil(textLength / columns);
    return indices.sort((a, b) => {
      const aOrdinal = (a % columns) * rows + Math.floor(a / columns);
      const bOrdinal = (b % columns) * rows + Math.floor(b / columns);
      return aOrdinal - bOrdinal;
    });
  }

  function updateAnalysis() {
    const layout = currentAnalysisLayout();
    const sequence = selectedSequence(layout).replace(/[^A-Z]/g, "");
    const grid = currentGrid();
    $("#analysisContext").textContent = layout?.isOverlay ? `LIVE OVERLAY · ${layout.label}` : layout?.isDifference ? layout.label : grid?.selected.size ? "CURRENT SELECTION" : "CURRENT GRID";
    $("#analyseAll").textContent = grid?.selected.size ? "Clear selection" : "Full grid";
    $("#analyseAll").disabled = !grid?.selected.size;
    $("#analysisSequence").textContent = sequence || "—";
    $("#analysisLength").textContent = `${sequence.length} character${sequence.length === 1 ? "" : "s"}`;
    if ($("#analysisPanel").classList.contains("active")) {
      scheduleModularStrideScan(sequence);
      scheduleGridShapeScan(layout);
    }
    if (sequence.length < 2) {
      $("#icValue").textContent = "—";
      $("#freqFit").textContent = "—";
      $("#icPValue").textContent = "—";
      $("#icReliability").textContent = "—";
      $("#freqPValue").textContent = "—";
      $("#topIcValue").textContent = "—";
      $("#topFreqFit").textContent = "—";
      $("#maxPeriodIc").textContent = "—";
      $("#maxPeriodLabel").textContent = "—";
      $("#icMeter").style.width = "0";
      $("#freqMeter").style.width = "0";
      $("#frequencyChart").innerHTML = '<div class="chart-placeholder">Select letters to analyse</div>';
      $("#bigramList").innerHTML = "<span>—</span>";
      $("#periodScanList").innerHTML = '<div class="chart-placeholder">Select enough letters to scan</div>';
      $("#periodDetail").classList.add("hidden");
      clearCompressionAnalysis();
      analysisSignalSignature = "";
      analysisBaseEvents = [];
      renderAnalysisSignal([]);
      return;
    }

    const counts = letterCounts(sequence);
    const ic = indexOfCoincidence(counts, sequence.length);
    const icSignificance = coincidenceSignificance(ic, sequence.length, state.alphabet.length || 26);
    const fit = frequencySimilarity(counts, sequence.length);
    const nulls = estimateNulls(sequence.length, ic, fit);
    $("#icValue").textContent = ic.toFixed(4);
    $("#freqFit").textContent = `${fit.toFixed(1)}%`;
    $("#topIcValue").textContent = ic.toFixed(4);
    $("#topFreqFit").textContent = `${fit.toFixed(1)}%`;
    $("#icPValue").textContent = formatPValue(icSignificance.twoSidedPValue);
    $("#icReliability").textContent = `${icSignificance.standardError.toFixed(4)} · ${icSignificance.zScore.toFixed(1)}σ`;
    $("#freqPValue").textContent = formatPercent(nulls.fit);
    $("#icMeter").style.width = `${clamp(ic / .1 * 100, 0, 100)}%`;
    $("#freqMeter").style.width = `${clamp(fit, 0, 100)}%`;
    renderFrequencyChart(counts, sequence.length);
    renderBigrams(sequence);
    const periodSummary = renderPeriodScan(sequence);
    const signature = `${layout?.id || "none"}:${sequence}`;
    analysisSignalSignature = signature;
    analysisBaseEvents = [
      { kind: "IC", label: `overall IC ${ic.toFixed(4)}`, pValue: icSignificance.twoSidedPValue },
      { kind: "frequency", label: `English frequency fit ${fit.toFixed(1)}%`, pValue: nulls.fit },
    ];
    if (periodSummary.rareCandidate) {
      const testedPeriods = Math.max(1, periodSummary.scan.length - 1);
      analysisBaseEvents.push({
        kind: "period",
        label: `period ${periodSummary.rareCandidate.period} IC ${periodSummary.rareCandidate.averageIc.toFixed(4)}`,
        pValue: Math.min(1, periodSummary.rareCandidate.significance.pValue * testedPeriods),
      });
    }
    renderAnalysisSignal(analysisBaseEvents, sequence.length);
    if ($("#analysisPanel").classList.contains("active")) scheduleCompressionAnalysis(sequence, signature);
  }

  function renderPeriodScan(sequence) {
    const maximum = Math.min(Number($("#periodScanMax").value), Math.max(1, Math.floor(sequence.length / 2)));
    $("#periodScanMaxValue").textContent = maximum;
    const scan = scanVigenerePeriods(sequence, maximum, state.alphabet.length || 26);
    const periodCandidates = scan.filter(candidate => candidate.period > 1);
    const maxCandidate = periodCandidates.length
      ? periodCandidates.reduce((best, candidate) => candidate.averageIc > best.averageIc ? candidate : best)
      : null;
    const rareCandidate = periodCandidates.length
      ? periodCandidates.reduce((best, candidate) => candidate.significance.pValue < best.significance.pValue ? candidate : best)
      : null;
    $("#maxPeriodIc").textContent = maxCandidate ? maxCandidate.averageIc.toFixed(4) : "—";
    $("#maxPeriodLabel").textContent = maxCandidate ? `period ${maxCandidate.period}` : "—";
    const signature = `${state.selectedGridId}:${sequence}`;
    if (signature !== analysisSequenceSignature) {
      analysisSequenceSignature = signature;
      analysisPeriod = scan.reduce((best, candidate) => candidate.significance.zScore > best.significance.zScore ? candidate : best, scan[0]).period;
    }
    analysisPeriod = clamp(analysisPeriod, 1, scan.length);
    $("#periodScanList").innerHTML = scan.map(candidate => {
      const strength = clamp(candidate.significance.zScore / 15 * 100, 2, 100);
      const significant = candidate.significance.zScore >= 2 && candidate.averageIc > candidate.significance.nullMean;
      return `<button class="period-scan-row${candidate.period === analysisPeriod ? " selected" : ""}${significant ? " likely" : ""}" data-period="${candidate.period}" title="Period ${candidate.period}: average IC ${candidate.averageIc.toFixed(4)}, null SE ${candidate.significance.standardError.toFixed(4)}, z ${candidate.significance.zScore.toFixed(2)}, p ${formatPValue(candidate.significance.pValue)}">
        <span>${candidate.period}</span><i><b style="width:${strength}%"></b></i><strong>${candidate.averageIc.toFixed(4)}</strong>
      </button>`;
    }).join("");
    renderPeriodDetail(sequence, analysisPeriod, true);
    return { scan, maxCandidate, rareCandidate };
  }

  function renderAnalysisSignal(events, sequenceLength = 0) {
    $$(".grid-card.analysis-event", workspace).forEach(card => {
      card.classList.remove("analysis-event");
      delete card.dataset.analysisSignal;
    });
    const signal = $("#analysisSignal");
    const rarest = sequenceLength >= 12
      ? events.filter(event => Number.isFinite(event.pValue) && event.pValue < .005).sort((a, b) => a.pValue - b.pValue)[0]
      : null;
    if (!rarest) {
      signal.classList.add("hidden");
      signal.textContent = "";
      return;
    }
    signal.textContent = `RARE ${rarest.kind.toUpperCase()} SIGNAL · ${rarest.label} · calibrated p ${formatPValue(rarest.pValue)}`;
    signal.classList.remove("hidden");
    const card = $(`.grid-card[data-id="${currentGrid()?.id}"]`, workspace);
    if (card) {
      card.classList.add("analysis-event");
      card.dataset.analysisSignal = rarest.kind;
    }
  }

  function clearCompressionAnalysis(message = "Select at least 12 letters.") {
    clearTimeout(compressionTimer);
    compressionToken++;
    $("#compressionBpc").textContent = "—";
    $("#compressionUniform").textContent = "—";
    $("#compressionShuffle").textContent = "—";
    $("#compressionStatus").textContent = message;
  }

  function ensureCompressionWorker() {
    if (compressionWorker) return compressionWorker;
    compressionWorker = new Worker("./compression-worker.js?v=1", { type: "module" });
    compressionWorker.addEventListener("message", event => {
      const { token, signature, result, error } = event.data;
      if (token !== compressionToken || signature !== analysisSignalSignature) return;
      compressionWorkerSignature = "";
      if (error) {
        $("#compressionStatus").textContent = error;
        return;
      }
      compressionCache.set(signature, result);
      if (compressionCache.size > 10) compressionCache.delete(compressionCache.keys().next().value);
      renderCompressionAnalysis(result, signature);
    });
    compressionWorker.addEventListener("error", () => {
      compressionWorkerSignature = "";
      $("#compressionStatus").textContent = "English model worker could not start.";
    });
    return compressionWorker;
  }

  function scheduleCompressionAnalysis(sequence, signature) {
    clearTimeout(compressionTimer);
    if (sequence.length < 12) return clearCompressionAnalysis();
    const cached = compressionCache.get(signature);
    if (cached) return renderCompressionAnalysis(cached, signature);
    const token = ++compressionToken;
    $("#compressionStatus").textContent = "English model calibration queued…";
    compressionTimer = setTimeout(() => {
      if (compressionWorkerSignature && compressionWorkerSignature !== signature) {
        compressionWorker?.terminate();
        compressionWorker = null;
      }
      compressionWorkerSignature = signature;
      $("#compressionStatus").textContent = "Comparing exact-length random and shuffled controls…";
      ensureCompressionWorker().postMessage({ token, signature, sequence });
    }, 260);
  }

  function renderCompressionAnalysis(result, signature) {
    if (signature !== analysisSignalSignature) return;
    $("#compressionBpc").textContent = result.bitsPerCharacter.toFixed(2);
    $("#compressionUniform").textContent = `p ${formatPValue(result.uniform.pValue)} · ${result.uniform.zScore.toFixed(1)}σ`;
    $("#compressionShuffle").textContent = `p ${formatPValue(result.shuffled.pValue)} · ${result.shuffled.zScore.toFixed(1)}σ`;
    $("#compressionStatus").textContent = `${result.uniform.trials.toLocaleString()} deterministic trials per control · ${result.bits.toFixed(0)} model bits`;
    const compressionP = Math.min(1, Math.min(result.uniform.pValue, result.shuffled.pValue) * 2);
    const source = result.uniform.pValue <= result.shuffled.pValue ? "uniform-null English code" : "same-letter ordering";
    renderAnalysisSignal([
      ...analysisBaseEvents,
      { kind: "compression", label: `${source} ${result.bitsPerCharacter.toFixed(2)} bits/character`, pValue: compressionP },
    ], result.length);
  }

  function renderPeriodDetail(sequence, period, resetKey = false) {
    const result = suggestVigenereKey(sequence, period, state.alphabet);
    analysisPeriod = period;
    $("#periodDetail").classList.remove("hidden");
    $("#chosenPeriod").textContent = period;
    $("#chosenPeriodIc").textContent = result.averageIc.toFixed(4);
    $("#periodNullSe").textContent = result.significance.standardError.toFixed(4);
    $("#periodZScore").textContent = `${result.significance.zScore.toFixed(2)}σ`;
    $("#periodPValue").textContent = formatPValue(result.significance.pValue);
    $("#periodNullBand").textContent = `${result.significance.nullLower95.toFixed(4)}–${result.significance.nullUpper95.toFixed(4)}`;
    $("#suggestedKey").textContent = result.key;
    if (resetKey) $("#candidateKey").value = result.key.replaceAll("?", "");
    renderVigenerePreview(sequence);
    $("#columnAnalysis").innerHTML = result.columns.map((column, index) => `<div title="${escapeHtml(column.text)}">
      <span>C${index + 1}</span><b>${result.shifts[index]?.letter || "?"}</b><i>n=${column.length}</i><strong>${column.ic.toFixed(4)}</strong>
    </div>`).join("");
  }

  function renderVigenerePreview(sequence = selectedSequence().replace(/[^A-Z]/g, "")) {
    const key = $("#candidateKey").value.toUpperCase().replace(/[^A-Z]/g, "");
    if ($("#candidateKey").value !== key) $("#candidateKey").value = key;
    const plaintext = decryptVigenere(sequence, key, state.alphabet);
    $("#decryptPreview").textContent = plaintext ? `${plaintext.slice(0, 180)}${plaintext.length > 180 ? "…" : ""}` : "Enter a candidate key";
  }

  function clearGridShapeScan(message = "Select a grid with at least four letters.") {
    gridShapeScanToken++;
    gridShapeLastSignature = "";
    gridDiagnosticScan = null;
    gridRouteScan = null;
    gridRouteSelected = null;
    $("#gridDiagnosticStatus").textContent = message;
    $("#gridDiagnosticList").innerHTML = "";
    $("#gridRouteStatus").textContent = "Select a grid with at least eight letters.";
    $("#gridRouteResults").innerHTML = "";
    $("#gridRouteDetail").classList.add("hidden");
  }

  function scheduleGridShapeScan(layout = currentAnalysisLayout()) {
    clearTimeout(gridShapeScanTimer);
    const length = layout ? layout.text.replace(/[^A-Z]/g, "").length : 0;
    if (!layout || length < 4) return clearGridShapeScan();
    const signature = JSON.stringify({ id: layout.id, text: layout.text, columns: layout.cols });
    if (signature === gridShapeLastSignature && gridDiagnosticScan) return;
    gridDiagnosticSelectedId = null;
    const token = ++gridShapeScanToken;
    $("#gridDiagnosticStatus").textContent = "Grid changed · line scan queued…";
    $("#gridRouteStatus").textContent = length >= 8 ? "Grid changed · route scan queued…" : "Select a grid with at least eight letters.";
    gridShapeScanTimer = setTimeout(() => runGridShapeScan(layout, length, signature, token), 240);
  }

  async function runGridShapeScan(layout, length, signature, token) {
    $("#gridDiagnosticStatus").textContent = "Scoring rows, columns, and diagonals…";
    if (length >= 8) $("#gridRouteStatus").textContent = "Scoring shape-aware routes…";
    try {
      const [diagnostics, routes] = await Promise.all([
        scanGridDiagnostics(layout.text, layout.cols),
        length >= 8 ? scanGridRoutes(layout.text, layout.cols) : Promise.resolve(null),
      ]);
      if (token !== gridShapeScanToken) return;
      gridShapeLastSignature = signature;
      gridDiagnosticScan = diagnostics;
      gridRouteScan = routes;
      gridRouteSelected = routes?.candidates[0] || null;
      $("#gridDiagnosticStatus").textContent = `${diagnostics.candidates.length} physical lines scored · click one to select it`;
      renderGridDiagnostics();
      if (routes) {
        $("#gridRouteStatus").textContent = `${routes.candidates.length} distinct traversals scored · click one to inspect it`;
        renderGridRouteResults();
        if (gridRouteSelected) renderGridRouteDetail(gridRouteSelected);
      }
    } catch (error) {
      if (token !== gridShapeScanToken) return;
      $("#gridDiagnosticStatus").textContent = `Grid scan failed: ${error.message}`;
      $("#gridRouteStatus").textContent = `Grid scan failed: ${error.message}`;
    }
  }

  function renderGridDiagnostics() {
    if (!gridDiagnosticScan) return;
    const candidates = gridDiagnosticScan.candidates.filter(candidate => gridDiagnosticFilter === "all" || candidate.kind === gridDiagnosticFilter);
    $("#gridDiagnosticList").innerHTML = candidates.map(candidate => {
      const heat = clamp((candidate.score + 2.5) / 5 * 100, 2, 100);
      const selected = candidate.id === gridDiagnosticSelectedId ? " selected" : "";
      const detail = `${candidate.label}: n=${candidate.length}, n-gram z=${candidate.score.toFixed(2)}, IC=${candidate.ic.toFixed(4)}, frequency fit=${candidate.frequencyFit.toFixed(1)}%, repeated-bigram density=${(candidate.repetitionDensity * 100).toFixed(1)}%, alphabet coverage=${(candidate.alphabetCoverage * 100).toFixed(1)}%`;
      return `<button class="grid-diagnostic-row${selected}" type="button" data-line-id="${candidate.id}" title="${escapeHtml(detail)}"><span>${candidate.label} · ${candidate.length}</span><i><b style="width:${heat}%"></b></i><strong>${candidate.ic.toFixed(3)}</strong><strong>${candidate.frequencyFit.toFixed(0)}</strong></button>`;
    }).join("") || '<div class="chart-placeholder">No lines in this group</div>';
  }

  function renderGridRouteResults() {
    if (!gridRouteScan) return;
    $("#gridRouteResults").innerHTML = gridRouteScan.candidates.map((candidate, index) => `<button class="stride-result-row${candidate === gridRouteSelected ? " selected" : ""}" type="button" data-grid-route-rank="${index}">
      <span>${index + 1}</span><strong>${candidate.label}</strong><b>z=${candidate.score.toFixed(2)}</b><small>${candidate.family} · ${candidate.route.length} letters</small>
    </button>`).join("");
  }

  function renderGridRouteDetail(candidate) {
    gridRouteSelected = candidate;
    renderGridRouteResults();
    $("#gridRouteDetail").classList.remove("hidden");
    $("#gridRouteName").textContent = candidate.label;
    $("#gridRouteScore").textContent = `z=${candidate.score.toFixed(2)}`;
    $("#gridRouteEvidence").innerHTML = gridRouteScan.sizes.map(size => `<span>${size}-gram <b>${candidate.ngrams[size].toFixed(3)}</b></span>`).join("");
    $("#gridRoutePreview").textContent = `${candidate.route.slice(0, 240)}${candidate.route.length > 240 ? "…" : ""}`;
  }

  function modularStrideSignature(sequence) {
    return JSON.stringify({
      grid: state.selectedGridId,
      sequence,
      mode: $("#strideScoreMode").value,
      sizes: $$(".ngram-size:checked").map(control => Number(control.value)),
      gap: $("#strideVirtualGap").checked,
      keyMaximum: Number($("#layeredKeyMax").value),
      alphabet: state.alphabet,
    });
  }

  function scheduleModularStrideScan(sequence = selectedSequence().replace(/[^A-Z]/g, "")) {
    clearTimeout(strideScanTimer);
    if (sequence.length < 8) {
      strideScanToken++;
      strideLastSignature = "";
      strideScan = null;
      strideSelected = null;
      strideSelectedRoute = "";
      $("#strideStatus").textContent = "Select at least 8 letters; the scan starts automatically when the selection settles.";
      $("#strideResults").innerHTML = "";
      $("#strideDetail").classList.add("hidden");
      return;
    }
    const signature = modularStrideSignature(sequence);
    if (signature === strideLastSignature && strideScan) return;
    const token = ++strideScanToken;
    $("#strideStatus").textContent = "Selection changed · modular scan queued…";
    strideScanTimer = setTimeout(() => runModularStrideScan(sequence, signature, token), 240);
  }

  async function runModularStrideScan(sequence, signature, token) {
    const scoreMode = $("#strideScoreMode").value;
    const ngramSizes = $$(".ngram-size:checked").map(control => Number(control.value));
    if (scoreMode === "ngrams" && !ngramSizes.length) {
      $("#strideStatus").textContent = "Choose at least one n-gram size.";
      return;
    }
    $("#strideStatus").textContent = scoreMode === "ngrams" ? "Loading the English model and scanning routes…" : "Scanning each route and maximizing over Vigenère key lengths…";
    $("#strideResults").innerHTML = "";
    $("#strideDetail").classList.add("hidden");
    try {
      const result = await scanModularRoutes(sequence, {
        scoreMode,
        ngramSizes,
        includeVirtualGap: $("#strideVirtualGap").checked,
        maximumKeyLength: Number($("#layeredKeyMax").value),
        alphabetSize: state.alphabet.length || 26,
      });
      if (token !== strideScanToken) return;
      strideScan = result;
      strideLastSignature = signature;
      strideSelected = result.candidates[0] || null;
      $("#strideStatus").textContent = `${result.candidates.length} full-cycle routes tested · click a result to inspect it`;
      renderStrideResults();
      if (strideSelected) renderStrideDetail(strideSelected);
    } catch (error) {
      $("#strideStatus").textContent = `Scan failed: ${error.message}`;
    }
  }

  function renderStrideResults() {
    if (!strideScan) return;
    $("#strideResults").innerHTML = strideScan.candidates.slice(0, 14).map((candidate, index) => {
      const secondary = strideScan.scoreMode === "layered" ? `best L=${candidate.bestPeriod.period}` : `${strideScan.sizes.map(size => `${size}g`).join("+")}`;
      return `<button class="stride-result-row${candidate === strideSelected ? " selected" : ""}" data-stride-rank="${index}">
        <span>${index + 1}</span><strong>N=${candidate.step}</strong><i>mod ${candidate.modulus}${candidate.gap ? " · +gap" : ""}</i><b>z=${candidate.score.toFixed(2)}</b><small>${secondary}</small>
      </button>`;
    }).join("");
  }

  function renderStrideDetail(candidate) {
    strideSelected = candidate;
    renderStrideResults();
    $("#strideDetail").classList.remove("hidden");
    $("#strideStep").textContent = candidate.step;
    $("#strideModulus").textContent = candidate.modulus;
    $("#strideScore").textContent = `z=${candidate.score.toFixed(2)}`;
    if (strideScan.scoreMode === "ngrams") {
      const best = bestNgramRouteOffset(candidate, strideScan.models, strideScan.sizes);
      strideSelectedRoute = best.route;
      $("#strideEvidence").innerHTML = `<span>start <b>${best.start}</b></span>${strideScan.sizes.map(size => `<span>${size}-gram <b>${best.scores[size].toFixed(3)}</b></span>`).join("")}`;
      $("#layeredPreview").classList.add("hidden");
      $("#createStrideGrid").classList.remove("hidden");
    } else {
      strideSelectedRoute = candidate.route;
      const period = candidate.bestPeriod;
      $("#strideEvidence").innerHTML = `<span>best key length <b>${period.period}</b></span><span>avg IC <b>${period.averageIc.toFixed(4)}</b></span><span>null SE <b>${period.significance.standardError.toFixed(4)}</b></span><span>single-L p <b>${formatPValue(period.significance.pValue)}</b></span>`;
      const suggestion = suggestVigenereKey(strideSelectedRoute, period.period, state.alphabet);
      $("#layeredCandidateKey").value = suggestion.key.replaceAll("?", "");
      $("#layeredPreview").classList.remove("hidden");
      $("#createStrideGrid").classList.add("hidden");
      renderLayeredStridePreview();
    }
    $("#stridePreview").textContent = `${strideSelectedRoute.slice(0, 240)}${strideSelectedRoute.length > 240 ? "…" : ""}`;
  }

  function renderLayeredStridePreview() {
    const key = $("#layeredCandidateKey").value.toUpperCase().replace(/[^A-Z]/g, "");
    if ($("#layeredCandidateKey").value !== key) $("#layeredCandidateKey").value = key;
    const plaintext = decryptVigenere(strideSelectedRoute, key, state.alphabet);
    $("#layeredDecryptPreview").textContent = plaintext ? `${plaintext.slice(0, 240)}${plaintext.length > 240 ? "…" : ""}` : "Enter a candidate key";
  }

  function renderFrequencyChart(counts, length) {
    const max = Math.max(...counts, 1);
    $("#frequencyChart").innerHTML = counts.map((count, index) => `
      <div class="frequency-bar${count === max ? " hot" : ""}" title="${String.fromCharCode(65 + index)}: ${count} (${(count / length * 100).toFixed(1)}%)">
        <i style="height:${Math.max(1, count / max * 80)}px"></i><span>${String.fromCharCode(65 + index)}</span>
      </div>`).join("");
  }

  function renderBigrams(sequence) {
    const counts = new Map();
    for (let i = 0; i < sequence.length - 1; i++) {
      const pair = sequence.slice(i, i + 2);
      counts.set(pair, (counts.get(pair) || 0) + 1);
    }
    const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
    $("#bigramList").innerHTML = top.map(([pair, count]) => `<span>${pair}<b>${count}</b></span>`).join("") || "<span>—</span>";
  }

  function updateAlphabetPreview() {
    $("#alphabetPreview").innerHTML = [...state.alphabet].map((letter, index) => `<span title="Index ${index}">${escapeHtml(letter)}</span>`).join("");
  }

  function updateStatus() {
    const grid = currentGrid();
    $("#gridCount").textContent = `${state.grids.length} grid${state.grids.length === 1 ? "" : "s"}`;
    $("#selectionCount").textContent = state.selectedGridIds.length > 1 ? `${state.selectedGridIds.length} grids selected` : grid?.selected.size ? `${grid.selected.size} cells selected` : state.selectedGridIds.length === 1 ? "1 grid selected" : "No selection";
  }

  function setStatus(message) {
    $("#statusText").textContent = message;
    updateStatus();
  }

  function clearAllCellSelections() {
    if (!state.grids.some(grid => grid.selected.size)) return false;
    const before = captureSnapshot();
    state.grids.forEach(grid => grid.selected.clear());
    state.analysisFullGrid = true;
    renderAll();
    commitHistory(before, "clear cell selections");
    setStatus("Cell selections cleared");
    return true;
  }

  function selectAllGridCells() {
    const grid = currentGrid();
    if (!grid) return false;
    const indices = [...grid.text]
      .map((letter, index) => letter === " " ? null : index)
      .filter(index => index !== null);
    if (!indices.length) return false;
    const before = captureSnapshot();
    grid.selected = new Set(indices);
    grid.selectionOrientation = "horizontal";
    synchronizeSelection(grid);
    state.analysisFullGrid = false;
    renderAll();
    commitHistory(before, `select all cells in ${grid.name}`);
    setStatus(`Selected all ${indices.length} cells in ${grid.name}`);
    return true;
  }

  function nudgeCurrentGrid(key, multiplier = 1) {
    const grid = currentGrid();
    if (!grid) return false;
    const directions = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const direction = directions[key];
    if (!direction) return false;
    const stride = (grid.cellSize + 2) * state.zoom * multiplier;
    const nextX = Math.max(0, Math.round((grid.x + direction[0] * stride) * 100) / 100);
    const nextY = Math.max(0, Math.round((grid.y + direction[1] * stride) * 100) / 100);
    if (nextX === grid.x && nextY === grid.y) {
      setStatus(`${grid.name} is at the canvas edge`);
      return true;
    }
    const before = captureSnapshot();
    grid.x = nextX;
    grid.y = nextY;
    state.overlays = removeOverlayLinksForGrid(state.overlays, grid.id);
    renderAll();
    commitHistory(before, `nudge ${grid.name} ${multiplier} cell${multiplier === 1 ? "" : "s"}`);
    setStatus(`Moved ${grid.name} ${multiplier} cell${multiplier === 1 ? "" : "s"}`);
    return true;
  }

  function applyZoom() {
    $$(".grid-card", workspace).forEach(card => card.style.transform = `scale(${state.zoom})`);
    $("#zoomLabel").textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function setWorkspaceZoom(nextZoom, anchor = null) {
    const previousZoom = state.zoom;
    const next = clamp(Math.round(nextZoom * 100) / 100, .5, 2);
    if (next === previousZoom) return false;
    const bounds = workspace.getBoundingClientRect();
    const anchorPoint = {
      x: workspace.scrollLeft + (anchor ? anchor.clientX - bounds.left : workspace.clientWidth / 2),
      y: workspace.scrollTop + (anchor ? anchor.clientY - bounds.top : workspace.clientHeight / 2),
    };
    const scaled = scaleCanvasPositions(state.grids, previousZoom, next, anchorPoint);
    const positions = new Map(scaled.positions.map(position => [position.id, position]));
    state.grids.forEach(grid => {
      const position = positions.get(grid.id);
      if (position) { grid.x = position.x; grid.y = position.y; }
    });
    state.zoom = next;
    reconcileOverlayState();
    state.grids.forEach(grid => {
      const card = $(`.grid-card[data-id="${grid.id}"]`, workspace);
      if (!card) return;
      card.style.left = `${grid.x}px`;
      card.style.top = `${grid.y}px`;
    });
    applyZoom();
    updateWorkspaceExtent();
    workspace.scrollLeft += scaled.scrollAdjustment.x;
    workspace.scrollTop += scaled.scrollAdjustment.y;
    return true;
  }

  function copyText(value) {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value).then(() => toast("Copied to clipboard")).catch(() => fallbackCopy(value));
    else fallbackCopy(value);
  }

  function fallbackCopy(value) {
    const area = document.createElement("textarea");
    area.value = value; document.body.appendChild(area); area.select(); document.execCommand("copy"); area.remove(); toast("Copied to clipboard");
  }

  function formatGridForClipboard(grid) {
    const layout = differenceLayoutForGrid(grid);
    if (grid.selected.size && layout.sourceIndices) {
      return [...layout.text].filter((_, index) => grid.selected.has(layout.sourceIndices[index])).join("");
    }
    return formatWholeGridForClipboard(grid);
  }

  function formatWholeGridForClipboard(grid) {
    const layout = differenceLayoutForGrid(grid);
    const rows = [];
    for (let index = 0; index < layout.text.length; index += layout.columns) rows.push(layout.text.slice(index, index + layout.columns));
    return rows.join("\n");
  }

  function pasteGridBundle(bundle) {
    const before = captureSnapshot();
    const cascade = (state.grids.length % 5) * 16;
    const pasted = instantiateGridBundle(bundle, {
      anchorX: workspace.scrollLeft + 32 + cascade,
      anchorY: workspace.scrollTop + 32 + cascade,
      idFactory: prefix => uniqueId(prefix),
      nextZ: () => ++state.z,
    });
    if (!pasted) return false;
    pasted.grids.forEach(grid => {
      grid.selected = new Set();
      grid.highlights = { ...(grid.highlights || {}) };
      state.grids.push(grid);
    });
    state.overlays.push(...pasted.overlays);
    state.selectedGridIds = pasted.grids.map(grid => grid.id);
    state.selectedGridId = state.selectedGridIds.at(-1);
    renderAll();
    commitHistory(before, `paste ${pasted.grids.length} grid${pasted.grids.length === 1 ? "" : "s"}`);
    toast(`Pasted ${pasted.grids.length} grid${pasted.grids.length === 1 ? "" : "s"}`);
    return true;
  }

  function pastedColumnCount(raw, fallback) {
    const lines = String(raw || "").trim().split(/\r?\n/).map(cleanText).filter(Boolean);
    if (lines.length > 1 && lines.every(line => line.length === lines[0].length)) return lines[0].length;
    return fallback;
  }

  function balancedColumnCount(length) {
    if (length < 2) return 1;
    return clamp(Math.ceil(Math.sqrt(length * 1.6)), 1, Math.min(40, length));
  }

  function pasteIntoGrid(raw) {
    const text = cleanText(raw);
    if (!text) return toast("The clipboard contains no letters");
    let grid = currentGrid();
    if (!grid) {
      const columns = pastedColumnCount(raw, balancedColumnCount(text.length));
      addGrid(text, "Pasted text", { cols: columns, fitContent: true });
      return toast(`Created a ${text.length}-letter grid from the clipboard`);
    }
    const historyBefore = captureSnapshot();
    const targetGrid = synchronizedRoot(grid);
    targetGrid.derived = null;
    let replaced = [];
    if (grid.selected.size) {
      let targets = orderedSelectionIndices(grid);
      if (targets.length === 1 && grid.selectionOrientation !== "vertical") {
        const start = targets[0];
        targets = Array.from({ length: text.length }, (_, index) => start + index);
      } else if (targets.length === 1) {
        const rows = Math.ceil(grid.text.length / grid.cols);
        const allVertical = Array.from({ length: grid.text.length }, (_, index) => index).sort((a, b) => {
          const aOrdinal = (a % grid.cols) * rows + Math.floor(a / grid.cols);
          const bOrdinal = (b % grid.cols) * rows + Math.floor(b / grid.cols);
          return aOrdinal - bOrdinal;
        });
        targets = allVertical.slice(allVertical.indexOf(targets[0]));
      }
      const characters = [...targetGrid.text];
      targets.slice(0, text.length).forEach((index, offset) => {
        while (characters.length < index) characters.push("X");
        characters[index] = text[offset];
        replaced.push(index);
      });
      targetGrid.text = characters.join("");
      targetGrid.selected = new Set(replaced);
      grid.selected = new Set(replaced);
      state.analysisFullGrid = false;
      if (text.length > targets.length) toast(`Pasted ${targets.length} letters; the selection has no more cells`);
      else toast(`Pasted ${Math.min(text.length, targets.length)} letters into the selection`);
    } else {
      targetGrid.text = text;
      if (targetGrid.id === grid.id) grid.cols = clamp(pastedColumnCount(raw, grid.cols), 1, 500);
      grid.selected.clear();
      targetGrid.selected.clear();
      state.analysisFullGrid = true;
      toast(`Replaced ${grid.name} with ${text.length} pasted letters`);
    }
    synchronizeSelection(grid);
    renderAll();
    commitHistory(historyBefore, `paste into ${grid.name}`);
  }

  function shiftHighlightsForEdit(grid, index, mode) {
    if (mode === "replace") return;
    const next = {};
    Object.entries(grid.highlights || {}).forEach(([rawIndex, colour]) => {
      const oldIndex = Number(rawIndex);
      if (mode === "delete" && oldIndex === index) return;
      if (mode === "before" && oldIndex >= index) next[oldIndex + 1] = colour;
      else if (mode === "after" && oldIndex > index) next[oldIndex + 1] = colour;
      else if (mode === "delete" && oldIndex > index) next[oldIndex - 1] = colour;
      else next[oldIndex] = colour;
    });
    grid.highlights = next;
  }

  function shiftHighlightsForDeletions(grid, deletedIndices) {
    const deleted = new Set(deletedIndices);
    const ascending = [...deleted].sort((a, b) => a - b);
    const next = {};
    Object.entries(grid.highlights || {}).forEach(([rawIndex, colour]) => {
      const oldIndex = Number(rawIndex);
      if (deleted.has(oldIndex)) return;
      const shift = ascending.filter(index => index < oldIndex).length;
      next[oldIndex - shift] = colour;
    });
    grid.highlights = next;
  }

  function colourSelectedLetters(colour) {
    const grid = currentGrid();
    if (!grid) return;
    const indices = [...grid.selected].filter(index => grid.text[index] && grid.text[index] !== " ");
    if (!indices.length) return toast("Select one or more letters first");
    const before = captureSnapshot();
    const highlights = { ...(grid.highlights || {}) };
    indices.forEach(index => {
      if (colour === "clear") delete highlights[index];
      else highlights[index] = colour;
    });
    grid.highlights = highlights;
    renderAll();
    const action = colour === "clear" ? "clear colour from" : `colour ${colour}`;
    commitHistory(before, `${action} ${indices.length} letters in ${grid.name}`);
    toast(colour === "clear" ? `Cleared colour from ${indices.length} letter${indices.length === 1 ? "" : "s"}` : `Coloured ${indices.length} letter${indices.length === 1 ? "" : "s"} ${colour}`);
  }

  function editLetterAt(grid, index, mode) {
    const before = captureSnapshot();
    const targetGrid = synchronizedRoot(grid);
    targetGrid.derived = null;
    synchronizedGroup(targetGrid).forEach(item => shiftHighlightsForEdit(item, index, mode));
    const characters = [...targetGrid.text];
    if (mode === "replace") characters[index] = "?";
    if (mode === "before") characters.splice(index, 0, "?");
    if (mode === "after") characters.splice(index + 1, 0, "?");
    if (mode === "delete") characters.splice(index, 1);
    targetGrid.text = characters.join("");
    const selectedIndex = mode === "after" ? index + 1 : Math.min(index, Math.max(0, targetGrid.text.length - 1));
    targetGrid.selected = targetGrid.text.length ? new Set([selectedIndex]) : new Set();
    grid.selected = new Set(targetGrid.selected);
    synchronizeSelection(grid);
    renderAll();
    commitHistory(before, `${mode} letter in ${grid.name}`);
  }

  function deleteSelectedLetters() {
    const grid = currentGrid();
    if (!grid?.selected.size) return false;
    const before = captureSnapshot();
    const targetGrid = synchronizedRoot(grid);
    targetGrid.derived = null;
    const selectedIndices = [...grid.selected].sort((a, b) => b - a);
    synchronizedGroup(targetGrid).forEach(item => shiftHighlightsForDeletions(item, selectedIndices));
    const characters = [...targetGrid.text];
    selectedIndices.forEach(index => {
      if (index >= 0 && index < characters.length) characters.splice(index, 1);
    });
    targetGrid.text = characters.join("");
    grid.selected.clear();
    targetGrid.selected.clear();
    synchronizeSelection(grid);
    renderAll();
    commitHistory(before, `delete ${selectedIndices.length} letters from ${grid.name}`);
    toast(`Deleted ${selectedIndices.length} selected letter${selectedIndices.length === 1 ? "" : "s"}`);
    return true;
  }

  function typeIntoSelection(letter) {
    const grid = currentGrid();
    if (!grid?.selected.size) return false;
    const targets = [...grid.selected].sort((a, b) => a - b);
    const index = targets[0];
    const before = captureSnapshot();
    const targetGrid = synchronizedRoot(grid);
    targetGrid.derived = null;
    const characters = [...targetGrid.text];
    characters[index] = letter.toUpperCase();
    targetGrid.text = characters.join("");
    const remaining = new Set(targets.slice(1));
    targetGrid.selected = new Set(remaining);
    grid.selected = new Set(remaining);
    grid.selectionOrientation = "horizontal";
    state.analysisFullGrid = remaining.size === 0;
    synchronizeSelection(grid);
    renderAll();
    commitHistory(before, `type ${letter.toUpperCase()} into ${grid.name}`);
    setStatus(remaining.size
      ? `Typed ${letter.toUpperCase()} · ${remaining.size} selected cell${remaining.size === 1 ? "" : "s"} remaining`
      : `Finished typing into ${grid.name}`);
    return true;
  }

  function finishAppendTyping() {
    if (!appendTypingSession) return;
    clearTimeout(appendTypingTimer);
    const session = appendTypingSession;
    appendTypingSession = null;
    commitHistory(session.before, `edit end of ${session.name}`);
  }

  function scheduleAppendRender(gridId) {
    appendScrollGridId = gridId;
    if (appendRenderFrame === null) {
      appendRenderFrame = requestAnimationFrame(() => {
        appendRenderFrame = null;
        renderAll();
        const body = $(`.grid-card[data-id="${appendScrollGridId}"] .grid-card-body`, workspace);
        if (body) {
          body.scrollLeft = body.scrollWidth;
          body.scrollTop = body.scrollHeight;
        }
      });
    }
    clearTimeout(appendTypingTimer);
    appendTypingTimer = setTimeout(finishAppendTyping, 450);
  }

  function beginAppendTyping(grid) {
    if (appendTypingSession?.gridId !== grid.id) finishAppendTyping();
    if (!appendTypingSession) appendTypingSession = { before: captureSnapshot(), gridId: grid.id, name: grid.name };
    return synchronizedRoot(grid);
  }

  function appendLetterToCurrentGrid(letter) {
    const grid = currentGrid();
    if (!grid || state.selectedGridIds.length !== 1 || grid.selected.size) return false;
    const targetGrid = beginAppendTyping(grid);
    targetGrid.derived = null;
    targetGrid.text += letter.toUpperCase();
    state.analysisFullGrid = true;
    scheduleAppendRender(grid.id);
    setStatus(`Appended ${letter.toUpperCase()} to ${grid.name}`);
    return true;
  }

  function removeLastLetterFromCurrentGrid() {
    const grid = currentGrid();
    if (!grid || state.selectedGridIds.length !== 1 || grid.selected.size) return false;
    const targetGrid = synchronizedRoot(grid);
    if (!targetGrid.text.length) return false;
    beginAppendTyping(grid);
    targetGrid.derived = null;
    const removedIndex = targetGrid.text.length - 1;
    synchronizedGroup(targetGrid).forEach(item => shiftHighlightsForDeletions(item, [removedIndex]));
    targetGrid.text = targetGrid.text.slice(0, -1);
    state.analysisFullGrid = true;
    scheduleAppendRender(grid.id);
    setStatus(`Removed the final letter from ${grid.name}`);
    return true;
  }

  function renameGrid(grid) {
    selectGrid(grid.id, true);
    const input = $("#gridName");
    input.focus();
    input.select();
    setStatus("Edit the grid name in Properties, then press Enter");
  }

  function loadSnapshot() {
    try {
      const raw = localStorage.getItem(LEGACY_SNAPSHOT_KEY);
      if (!raw) return false;
      const snapshot = JSON.parse(raw);
      state.grids = snapshot.grids.map(grid => ({
        ...grid,
        derived: grid.derived ? { ...grid.derived, alignment: grid.derived.alignment ? { ...grid.derived.alignment } : null } : null,
        highlights: { ...(grid.highlights || {}) },
        selected: new Set(grid.selected || []),
      }));
      state.overlays = normalizeOverlayLinks(snapshot.overlays);
      state.alphabet = snapshot.alphabet || KRYPTOS_ALPHABET;
      state.cellSize = snapshot.cellSize || 28;
      $("#workspaceTitle").textContent = snapshot.workspaceTitle || snapshot.title || "K4 / Transposition studies";
      state.selectedGridId = snapshot.selectedGridId || state.grids[0]?.id || null;
      state.selectedGridIds = snapshot.selectedGridIds || (state.selectedGridId ? [state.selectedGridId] : []);
      return true;
    } catch { return false; }
  }

  function bindUi() {
    $("#addGrid").addEventListener("click", () => addGrid());
    $("#undoAction").addEventListener("click", undo);
    $("#redoAction").addEventListener("click", redo);
    $("#duplicateGrid").addEventListener("click", duplicateGrid);
    $("#cloneExtend").addEventListener("click", event => {
      event.stopPropagation();
      $("#cloneExtendPopover").classList.contains("hidden") ? openCloneExtend() : closeCloneExtend();
    });
    $("#repeatCount").addEventListener("input", updateCloneExtendPreview);
    $("#applyCloneExtend").addEventListener("click", () => cloneAndExtend(Number.parseInt($("#repeatCount").value, 10)));
    $("#cancelCloneExtend").addEventListener("click", closeCloneExtend);
    $("#cloneExtendPopover").addEventListener("pointerdown", event => event.stopPropagation());
    $("#createSyncedView").addEventListener("click", createSynchronizedView);
    $("#deleteGrid").addEventListener("click", deleteGrid);
    $("#rotateLeft").addEventListener("click", () => transformGrid("left"));
    $("#rotateRight").addEventListener("click", () => transformGrid("right"));
    $("#transpose").addEventListener("click", () => transformGrid("transpose"));
    $("#mirrorGrid").addEventListener("click", () => transformGrid("mirror"));
    $("#reflectVertical").addEventListener("click", () => transformGrid("reflectVertical"));
    $("#compactGrid").addEventListener("click", compactSelectedGrid);
    $$(".letter-colour-button").forEach(button => button.addEventListener("click", () => colourSelectedLetters(button.dataset.letterColour)));
    $("#differenceView").addEventListener("click", event => {
      const button = event.target.closest("[data-difference-axis]");
      const grid = currentGrid();
      if (!button || !grid) return;
      const before = captureSnapshot();
      const axis = button.dataset.differenceAxis;
      const modes = differenceModes(grid);
      grid.differenceHorizontal = axis === "horizontal" ? !modes.horizontal : modes.horizontal;
      grid.differenceVertical = axis === "vertical" ? !modes.vertical : modes.vertical;
      delete grid.differenceView;
      renderAll();
      commitHistory(before, `toggle ${axis} differences for ${grid.name}`);
      const active = differenceModes(grid);
      const label = active.horizontal && active.vertical ? "horizontal and vertical" : active.horizontal ? "horizontal" : active.vertical ? "vertical" : "no";
      setStatus(`Showing ${label} differences in ${grid.name}`);
    });

    $$(".tool-button[data-mode]").forEach(button => button.addEventListener("click", () => {
      state.tool = button.dataset.mode;
      $$(".tool-button[data-mode]").forEach(item => item.classList.toggle("active", item === button));
      workspace.classList.toggle("panning", state.tool === "pan");
      setStatus(`${button.textContent.trim()} tool active`);
    }));
    $$(".collapse").forEach(button => button.addEventListener("click", () => {
      const section = button.closest(".inspector-section");
      if (!section) return;
      const collapsed = section.classList.toggle("collapsed");
      const sectionName = $(".section-title > span", section)?.textContent.toLowerCase() || "inspector";
      button.textContent = collapsed ? "⌄" : "⌃";
      button.setAttribute("aria-expanded", String(!collapsed));
      button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${sectionName} section`);
    }));
    $$(".info-button").forEach(button => button.addEventListener("click", () => toast(button.dataset.info, 4500)));

    let panStart = null;
    const pointerHitsWorkspaceScrollbar = event => {
      const bounds = workspace.getBoundingClientRect();
      const verticalWidth = workspace.offsetWidth - workspace.clientWidth;
      const horizontalHeight = workspace.offsetHeight - workspace.clientHeight;
      return (verticalWidth > 0 && event.clientX >= bounds.right - verticalWidth)
        || (horizontalHeight > 0 && event.clientY >= bounds.bottom - horizontalHeight);
    };
    let wheelZoomBefore = null;
    let wheelZoomTimer = null;
    workspace.addEventListener("wheel", event => {
      event.preventDefault();
      if (!event.deltaY) return;
      const startedSequence = !wheelZoomBefore;
      if (!wheelZoomBefore) wheelZoomBefore = captureSnapshot();
      const changed = setWorkspaceZoom(state.zoom + (event.deltaY < 0 ? .08 : -.08), event);
      if (!changed) {
        if (startedSequence) wheelZoomBefore = null;
        return;
      }
      clearTimeout(wheelZoomTimer);
      wheelZoomTimer = setTimeout(() => {
        const before = wheelZoomBefore;
        wheelZoomBefore = null;
        commitHistory(before, "zoom with mouse wheel");
      }, 180);
    }, { passive: false });
    workspace.addEventListener("pointerdown", event => {
      if (event.target.closest(".grid-card")) return;
      if (pointerHitsWorkspaceScrollbar(event)) return;
      if (state.tool === "pan") {
        panStart = { x: event.clientX, y: event.clientY, left: workspace.scrollLeft, top: workspace.scrollTop };
        workspace.classList.add("active-pan");
        return;
      }
      if (event.button !== 0) return;
      event.preventDefault();
      const before = captureSnapshot();
      const bounds = workspace.getBoundingClientRect();
      const start = {
        clientX: event.clientX,
        clientY: event.clientY,
        contentX: event.clientX - bounds.left + workspace.scrollLeft,
        contentY: event.clientY - bounds.top + workspace.scrollTop,
      };
      const additive = event.ctrlKey || event.metaKey || event.shiftKey;
      const initialIds = additive ? [...state.selectedGridIds] : [];
      const marquee = document.createElement("div");
      marquee.className = "selection-marquee hidden";
      workspace.appendChild(marquee);
      workspace.classList.add("marquee-selecting");
      let moved = false;
      let hitIds = [];

      const move = moveEvent => {
        const dx = moveEvent.clientX - start.clientX;
        const dy = moveEvent.clientY - start.clientY;
        if (!moved && Math.hypot(dx, dy) < 5) return;
        moved = true;
        marquee.classList.remove("hidden");
        const currentX = moveEvent.clientX - bounds.left + workspace.scrollLeft;
        const currentY = moveEvent.clientY - bounds.top + workspace.scrollTop;
        marquee.style.left = `${Math.min(start.contentX, currentX)}px`;
        marquee.style.top = `${Math.min(start.contentY, currentY)}px`;
        marquee.style.width = `${Math.abs(currentX - start.contentX)}px`;
        marquee.style.height = `${Math.abs(currentY - start.contentY)}px`;
        const selectionBounds = {
          left: Math.min(start.clientX, moveEvent.clientX),
          right: Math.max(start.clientX, moveEvent.clientX),
          top: Math.min(start.clientY, moveEvent.clientY),
          bottom: Math.max(start.clientY, moveEvent.clientY),
        };
        hitIds = $$(".grid-card", workspace).filter(card => {
          const rect = card.getBoundingClientRect();
          return rect.right >= selectionBounds.left && rect.left <= selectionBounds.right
            && rect.bottom >= selectionBounds.top && rect.top <= selectionBounds.bottom;
        }).map(card => card.dataset.id);
        $$(".grid-card", workspace).forEach(card => card.classList.toggle("marquee-target", hitIds.includes(card.dataset.id)));
      };
      const end = endEvent => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", end);
        document.removeEventListener("pointercancel", end);
        marquee.remove();
        workspace.classList.remove("marquee-selecting");
        $$(".grid-card.marquee-target", workspace).forEach(card => card.classList.remove("marquee-target"));
        if (endEvent.type === "pointercancel") return restoreSnapshot(before);
        state.grids.forEach(grid => grid.selected.clear());
        if (moved) {
          state.selectedGridIds = [...new Set([...initialIds, ...hitIds])];
          const primary = state.grids.filter(grid => state.selectedGridIds.includes(grid.id)).sort((a, b) => (a.z || 0) - (b.z || 0)).at(-1);
          state.selectedGridId = primary?.id || null;
          state.analysisFullGrid = true;
          renderAll();
          commitHistory(before, `marquee select ${state.selectedGridIds.length} grids`);
          setStatus(state.selectedGridIds.length ? `Selected ${state.selectedGridIds.length} grid${state.selectedGridIds.length === 1 ? "" : "s"}` : "No grids inside selection");
          return;
        }
        const hasCanvasSelection = state.selectedGridId || state.selectedGridIds.length || state.grids.some(grid => grid.selected.size);
        state.selectedGridId = null;
        state.selectedGridIds = [];
        state.analysisFullGrid = true;
        if (hasCanvasSelection) {
          renderAll();
          commitHistory(before, "clear canvas selection");
          setStatus("Grid focus and cell selections cleared");
        }
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", end, { once: true });
      document.addEventListener("pointercancel", end, { once: true });
    });
    workspace.addEventListener("dblclick", event => {
      if (event.target.closest(".grid-card")) return;
      const bounds = workspace.getBoundingClientRect();
      const x = Math.max(0, Math.round((event.clientX - bounds.left + workspace.scrollLeft) / 8) * 8);
      const y = Math.max(0, Math.round((event.clientY - bounds.top + workspace.scrollTop) / 8) * 8);
      addGrid("KRYPTOS", null, { x, y, width: 260, height: 180 });
      setStatus("Created a grid at the double-click position");
    });
    workspace.addEventListener("contextmenu", event => {
      event.preventDefault();
      const card = event.target.closest(".grid-card");
      const cell = event.target.closest(".letter-cell");
      if (card) {
        const grid = state.grids.find(item => item.id === card.dataset.id);
        if (!grid) return;
        if (!state.selectedGridIds.includes(grid.id)) state.selectedGridIds = [grid.id];
        selectGrid(grid.id, true);
        const items = [];
        if (cell) {
          const index = Number(cell.dataset.index);
          items.push(
            { icon: "?", label: `Set letter ${index + 1} to unknown`, action: () => editLetterAt(grid, index, "replace") },
            { icon: "←", label: "Insert unknown before", action: () => editLetterAt(grid, index, "before") },
            { icon: "→", label: "Insert unknown after", action: () => editLetterAt(grid, index, "after") },
            { icon: "×", label: "Delete this letter", danger: true, action: () => editLetterAt(grid, index, "delete") },
            { separator: true },
          );
        }
        items.push(
          { icon: "⌘", label: "Copy grid", action: () => copyText(formatGridForClipboard(grid)) },
          { icon: "✎", label: "Rename grid", action: () => renameGrid(grid) },
          { icon: "⧉", label: "Duplicate grid", action: duplicateGrid },
          { icon: "⇄", label: "Create synchronized view…", action: createSynchronizedView },
          { icon: "↷", label: "Rotate clockwise", action: () => transformGrid("right") },
          { icon: "⤢", label: "Transpose", action: () => transformGrid("transpose") },
          { icon: "⇆", label: "Mirror left ↔ right", action: () => transformGrid("mirror") },
          { icon: "⇅", label: "Reflect top ↔ bottom", action: () => transformGrid("reflectVertical") },
          { separator: true },
          { icon: "⌫", label: "Delete grid", danger: true, action: deleteGrid },
        );
        showContextMenu(items, event.clientX, event.clientY);
        return;
      }
      const bounds = workspace.getBoundingClientRect();
      const x = Math.max(0, Math.round((event.clientX - bounds.left + workspace.scrollLeft) / 8) * 8);
      const y = Math.max(0, Math.round((event.clientY - bounds.top + workspace.scrollTop) / 8) * 8);
      showContextMenu([
        { icon: "▦", label: "New grid here", action: () => addGrid("KRYPTOS", null, { x, y, width: 260, height: 180 }) },
        { icon: "⌘", label: "Paste as new grid here", action: async () => {
          try {
            const raw = await navigator.clipboard.readText();
            const text = cleanText(raw);
            if (!text) return toast("The clipboard contains no letters");
            const columns = pastedColumnCount(raw, balancedColumnCount(text.length));
            addGrid(text, "Pasted text", { x, y, cols: columns, fitContent: true });
          } catch { toast("Clipboard permission was denied"); }
        } },
        { separator: true },
        { icon: "K4", label: "Import K4 ciphertext", action: () => addGrid(K4_CIPHERTEXT, "K4 ciphertext", { x, y, cols: 14, width: 445, height: 280 }) },
        { icon: "?", label: "Import positional cribs", action: () => addGrid(positionalK4Cribs(), "K4 positional crib mask", { x, y, cols: 14, width: 445, height: 280, preserveSparse: true }) },
        { separator: true },
        { icon: "○", label: "Clear all cell selections", action: () => {
          if (!state.grids.some(grid => grid.selected.size)) return;
          const before = captureSnapshot();
          state.grids.forEach(grid => grid.selected.clear());
          state.analysisFullGrid = true;
          renderAll();
          commitHistory(before, "clear all cell selections");
        } },
      ], event.clientX, event.clientY);
    });
    document.addEventListener("pointerdown", event => { if (!event.target.closest("#contextMenu")) closeContextMenu(); });
    document.addEventListener("pointermove", event => {
      if (!panStart) return;
      workspace.scrollLeft = panStart.left - (event.clientX - panStart.x);
      workspace.scrollTop = panStart.top - (event.clientY - panStart.y);
    });
    document.addEventListener("pointerup", () => { panStart = null; workspace.classList.remove("active-pan"); });

    $("#gridName").addEventListener("focus", event => event.target._historyBefore = captureSnapshot());
    $("#gridName").addEventListener("input", event => { const grid = currentGrid(); if (grid) { grid.name = event.target.value; $(".grid-card-title", $(`.grid-card[data-id="${grid.id}"]`)).textContent = grid.name; } });
    $("#gridName").addEventListener("change", event => commitHistory(event.target._historyBefore, "rename grid"));
    $("#gridName").addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.target.blur();
      }
    });
    $("#gridColumns").addEventListener("change", event => { const grid = currentGrid(); if (grid) { const before = captureSnapshot(); grid.derived = null; if (grid.syncSourceId) grid.syncSourceId = null; grid.cols = clamp(Number(event.target.value) || 1, 1, 500); fitGridCardToContent(grid); renderAll(); commitHistory(before, `reshape ${grid.name}`); } });
    $("#cellSize").addEventListener("change", event => { const grid = currentGrid(); if (grid) { const before = captureSnapshot(); state.cellSize = clamp(Number(event.target.value) || 28, 20, 64); state.grids.forEach(item => { item.cellSize = state.cellSize; fitGridCardToContent(item); }); renderAll(); commitHistory(before, "resize workspace cells"); } });
    $("#applyText").addEventListener("click", () => {
      const grid = currentGrid();
      if (!grid) return;
      const text = cleanText($("#gridText").value);
      if (!text) return toast("Paste or type some letters first");
      const before = captureSnapshot();
      const targetGrid = synchronizedRoot(grid);
      targetGrid.derived = null;
      targetGrid.text = text;
      targetGrid.selected.clear();
      grid.selected.clear();
      synchronizeSelection(grid);
      renderAll();
      commitHistory(before, `edit text in ${grid.name}`);
      toast(`Applied ${text.length} letters to all synchronized views`);
    });
    $("#copyText").addEventListener("click", () => { const grid = currentGrid(); if (grid) copyText(formatGridForClipboard(grid)); });
    $("#pasteText").addEventListener("click", async () => {
      try { pasteIntoGrid(await navigator.clipboard.readText()); }
      catch { $("#gridText").focus(); toast("Clipboard permission was denied; paste into the text field instead"); }
    });

    $$("#alphabetPreset button").forEach(button => button.addEventListener("click", () => {
      const before = captureSnapshot();
      $$("#alphabetPreset button").forEach(item => item.classList.toggle("active", item === button));
      const custom = button.dataset.alphabet === "custom";
      $("#customAlphabet").classList.toggle("hidden", !custom);
      if (!custom) state.alphabet = button.dataset.alphabet;
      else state.alphabet = cleanUnique($("#customAlphabet").value) || NORMAL_ALPHABET;
      updateAlphabetPreview(); renderAll();
      commitHistory(before, "change alphabet");
    }));
    $("#customAlphabet").addEventListener("focus", event => event.target._historyBefore = captureSnapshot());
    $("#customAlphabet").addEventListener("input", event => { state.alphabet = cleanUnique(event.target.value); updateAlphabetPreview(); renderAll(); });
    $("#customAlphabet").addEventListener("change", event => commitHistory(event.target._historyBefore, "edit custom alphabet"));
    let preferenceHistoryBefore = null;
    [$("#showIndices"), $("#snapCombine"), $("#combineOperation")].forEach(control => control.addEventListener("pointerdown", () => { preferenceHistoryBefore = captureSnapshot(); }));
    $("#showIndices").addEventListener("change", () => { renderAll(); commitHistory(preferenceHistoryBefore, "toggle cell indices"); });
    $("#snapCombine").addEventListener("change", () => commitHistory(preferenceHistoryBefore, "toggle snap and combine"));
    $("#combineOperation").addEventListener("change", event => {
      const grid = currentGrid();
      if (grid?.derived) grid.derived.operation = event.target.value;
      const link = activeOverlayLink();
      if (link) link.operation = event.target.value;
      renderAll();
      commitHistory(preferenceHistoryBefore, "change combine operation");
    });
    $("#runGridOperation").addEventListener("click", () => {
      const selectedOperands = state.selectedGridIds.map(id => state.grids.find(grid => grid.id === id)).filter(Boolean);
      if (selectedOperands.length > 2) return toast("Select exactly two grids for an A/B operation");
      const link = activeOverlayLink(selectedOperands);
      const resolvedLink = link ? resolveOverlayLink(link, state.grids, state.alphabet) : null;
      const operandA = resolvedLink?.operandA || selectedOperands[0];
      const operandB = resolvedLink?.operandB || selectedOperands[1];
      if (!operandA || !operandB) return toast("Select operand A, then operand B");
      const before = captureSnapshot();
      const operation = link?.operation || $("#combineOperation").value;
      combineGrids(operandA, operandB);
      commitHistory(before, `${operation} ${operandA.name} and ${operandB.name}`);
    });

    $$(".inspector-tabs button").forEach(button => button.addEventListener("click", () => {
      $$(".inspector-tabs button").forEach(item => item.classList.toggle("active", item === button));
      $$(".tab-panel").forEach(panel => panel.classList.remove("active"));
      $(`#${button.dataset.tab}Panel`).classList.add("active");
      if (button.dataset.tab === "analysis") updateAnalysis();
    }));
    $("#analyseAll").addEventListener("click", () => {
      const grid = currentGrid();
      if (!grid?.selected.size) return;
      const before = captureSnapshot();
      grid.selected.clear();
      synchronizeSelection(grid);
      renderAll();
      commitHistory(before, "clear analysis selection");
    });
    $("#periodScanMax").addEventListener("input", () => {
      const sequence = selectedSequence().replace(/[^A-Z]/g, "");
      if (sequence.length >= 2) updateAnalysis();
    });
    $("#periodScanList").addEventListener("click", event => {
      const row = event.target.closest("[data-period]");
      if (!row) return;
      analysisPeriod = Number(row.dataset.period);
      const sequence = selectedSequence().replace(/[^A-Z]/g, "");
      renderPeriodScan(sequence);
    });
    $("#candidateKey").addEventListener("input", () => renderVigenerePreview());
    $("#gridDiagnosticFilters").addEventListener("click", event => {
      const button = event.target.closest("[data-line-kind]");
      if (!button) return;
      gridDiagnosticFilter = button.dataset.lineKind;
      $$("#gridDiagnosticFilters button").forEach(item => item.classList.toggle("active", item === button));
      renderGridDiagnostics();
    });
    $("#gridDiagnosticList").addEventListener("click", event => {
      const row = event.target.closest("[data-line-id]");
      const grid = currentGrid();
      const candidate = gridDiagnosticScan?.candidates.find(item => item.id === row?.dataset.lineId);
      if (!grid || !candidate) return;
      const before = captureSnapshot();
      gridDiagnosticSelectedId = candidate.id;
      grid.selected = new Set(candidate.indices);
      grid.selectionOrientation = candidate.kind === "column" ? "vertical" : "horizontal";
      synchronizeSelection(grid);
      renderAll();
      renderGridDiagnostics();
      commitHistory(before, `select ${candidate.label} in ${grid.name}`);
    });
    $("#gridRouteResults").addEventListener("click", event => {
      const row = event.target.closest("[data-grid-route-rank]");
      if (row && gridRouteScan) renderGridRouteDetail(gridRouteScan.candidates[Number(row.dataset.gridRouteRank)]);
    });
    $("#createGridRoute").addEventListener("click", () => {
      if (!gridRouteSelected) return;
      addGrid(gridRouteSelected.route, `2D route · ${gridRouteSelected.label}`, { cols: gridRouteSelected.outputColumns });
    });
    $("#strideScoreMode").addEventListener("change", event => {
      $("#layeredKeyLimit").classList.toggle("hidden", event.target.value !== "layered");
      $$(".ngram-size").forEach(control => control.closest("label").classList.toggle("muted-option", event.target.value !== "ngrams"));
      scheduleModularStrideScan();
    });
    $("#layeredKeyMax").addEventListener("input", event => { $("#layeredKeyMaxValue").textContent = event.target.value; scheduleModularStrideScan(); });
    $("#strideVirtualGap").addEventListener("change", () => scheduleModularStrideScan());
    $$(".ngram-size").forEach(control => control.addEventListener("change", () => scheduleModularStrideScan()));
    $("#strideResults").addEventListener("click", event => {
      const row = event.target.closest("[data-stride-rank]");
      if (row && strideScan) renderStrideDetail(strideScan.candidates[Number(row.dataset.strideRank)]);
    });
    $("#layeredCandidateKey").addEventListener("input", renderLayeredStridePreview);
    $("#createLayeredIntermediateGrid").addEventListener("click", () => {
      if (!strideSelected || !strideSelectedRoute || strideScan?.scoreMode !== "layered") return;
      const keyLength = strideSelected.bestPeriod.period;
      addGrid(
        strideSelectedRoute,
        `Intermediate · N=${strideSelected.step} mod ${strideSelected.modulus} · before Vigenère L=${keyLength}`,
        { cols: keyLength },
      );
    });
    $("#createStrideGrid").addEventListener("click", () => {
      if (!strideSelected || !strideSelectedRoute) return;
      const source = currentGrid();
      const columns = source?.cols || Math.ceil(Math.sqrt(strideSelectedRoute.length));
      addGrid(strideSelectedRoute, `Route N=${strideSelected.step} mod ${strideSelected.modulus}`, { cols: columns });
    });

    $("#zoomIn").addEventListener("click", () => { const before = captureSnapshot(); if (setWorkspaceZoom(state.zoom + .1)) commitHistory(before, "zoom in"); });
    $("#zoomOut").addEventListener("click", () => { const before = captureSnapshot(); if (setWorkspaceZoom(state.zoom - .1)) commitHistory(before, "zoom out"); });
    $("#helpButton").addEventListener("click", () => $("#helpModal").classList.remove("hidden"));
    $("#closeHelp").addEventListener("click", () => $("#helpModal").classList.add("hidden"));
    $("#helpModal").addEventListener("click", event => { if (event.target.id === "helpModal") event.currentTarget.classList.add("hidden"); });
    $("#aboutButton").addEventListener("click", () => {
      $("#aboutModal").classList.remove("hidden");
      $("#closeAbout").focus();
    });
    $("#closeAbout").addEventListener("click", () => {
      $("#aboutModal").classList.add("hidden");
      $("#aboutButton").focus();
    });
    $("#aboutModal").addEventListener("click", event => {
      if (event.target.id === "aboutModal") {
        event.currentTarget.classList.add("hidden");
        $("#aboutButton").focus();
      }
    });

    $("#workspaceTree").addEventListener("click", event => {
      const folderRow = event.target.closest(".tree-row.folder");
      const documentRow = event.target.closest(".tree-row.document");
      if (folderRow) {
        const folder = state.folders.find(item => item.id === folderRow.dataset.folderId);
        if (folder) { folder.open = !folder.open; state.activeFolderId = folder.id; renderWorkspaceTree(); scheduleLibraryPersistence(); }
      }
      if (documentRow) switchWorkspace(documentRow.dataset.workspaceId);
    });
    $("#workspaceTree").addEventListener("contextmenu", event => {
      event.preventDefault();
      const documentRow = event.target.closest(".tree-row.document");
      const folderRow = event.target.closest(".tree-row.folder");
      if (documentRow) {
        const entry = state.workspaces.find(item => item.id === documentRow.dataset.workspaceId);
        if (!entry) return;
        showContextMenu([
          { icon: "▦", label: "Open workspace", action: () => switchWorkspace(entry.id) },
          { icon: "✎", label: "Rename workspace", action: () => renameWorkspaceEntry(entry) },
          { icon: "⧉", label: "Duplicate workspace", action: () => {
            saveActiveWorkspaceState();
            const copy = { ...cloneSerializable(entry), id: uniqueId("workspace"), name: `${entry.name} copy` };
            state.workspaces.push(copy); renderWorkspaceTree(); scheduleLibraryPersistence();
          } },
          { separator: true },
          { icon: "⌫", label: "Delete workspace", danger: true, action: () => deleteWorkspaceEntry(entry) },
        ], event.clientX, event.clientY);
        return;
      }
      if (folderRow) {
        const folder = state.folders.find(item => item.id === folderRow.dataset.folderId);
        if (!folder) return;
        showContextMenu([
          { icon: "＋", label: "New workspace here", action: () => createWorkspace(folder.id) },
          { icon: "✎", label: "Rename folder", action: () => renameFolder(folder) },
          { separator: true },
          { icon: "⌫", label: "Delete folder", danger: true, action: () => {
            if (state.folders.length === 1) return toast("At least one folder must remain");
            const fallback = state.folders.find(item => item.id !== folder.id);
            state.workspaces.forEach(item => { if (item.folderId === folder.id) item.folderId = fallback.id; });
            state.folders = state.folders.filter(item => item.id !== folder.id);
            state.activeFolderId = fallback.id; renderWorkspaceTree(); scheduleLibraryPersistence();
          } },
        ], event.clientX, event.clientY);
        return;
      }
      showContextMenu([
        { icon: "＋", label: "New workspace", action: () => createWorkspace() },
        { icon: "▰", label: "New folder", action: createFolder },
      ], event.clientX, event.clientY);
    });
    $("#workspaceTree").addEventListener("dragstart", event => {
      const row = event.target.closest(".tree-row.document");
      if (row) event.dataTransfer.setData("text/x-kryptos-workspace", row.dataset.workspaceId);
    });
    $("#workspaceTree").addEventListener("dragover", event => {
      const target = event.target.closest("[data-folder-drop]");
      if (!target) return;
      event.preventDefault();
      $$(".tree-children.drag-target", $("#workspaceTree")).forEach(item => item.classList.remove("drag-target"));
      target.classList.add("drag-target");
    });
    $("#workspaceTree").addEventListener("dragleave", event => event.target.closest("[data-folder-drop]")?.classList.remove("drag-target"));
    $("#workspaceTree").addEventListener("drop", event => {
      const target = event.target.closest("[data-folder-drop]");
      if (!target) return;
      event.preventDefault();
      const entry = state.workspaces.find(item => item.id === event.dataTransfer.getData("text/x-kryptos-workspace"));
      if (entry) { entry.folderId = target.dataset.folderDrop; state.activeFolderId = entry.folderId; renderWorkspaceTree(); scheduleLibraryPersistence(); }
    });
    $$(".clip-row").forEach(row => row.addEventListener("click", () => addGrid(row.dataset.clip, "Clipboard fragment")));
    $$(".import-row").forEach(row => row.addEventListener("click", () => {
      const type = row.dataset.import;
      if (type === "left-plate") addGrid(KRYPTOS_LEFT_PLATE, "Kryptos left plate · ciphertext", { cols: KRYPTOS_LEFT_PLATE_COLUMNS, preserveSparse: true, fitContent: true });
      if (type === "right-plate") addGrid(KRYPTOS_RIGHT_PLATE, "Kryptos right plate · Vigenère tableau", { cols: KRYPTOS_RIGHT_PLATE_COLUMNS, preserveSparse: true, fitContent: true });
      if (type === "k1") addGrid(K1_CIPHERTEXT, "K1 ciphertext", { cols: 21, width: 648, height: 205 });
      if (type === "k2") addGrid(K2_CIPHERTEXT, "K2 ciphertext", { cols: 31, width: 948, height: 415 });
      if (type === "k3") addGrid(K3_CIPHERTEXT, "K3 ciphertext", { cols: 21, width: 648, height: 535 });
      if (type === "k4") addGrid(K4_CIPHERTEXT, "K4 ciphertext", { cols: 14, width: 445, height: 280 });
      if (type === "random-english") {
        const sample = randomEnglishBookSample();
        addGrid(sample.text, `English · ${sample.title}`, { cols: 10, width: 330, height: 395 });
      }
      if (type === "random-letters") addGrid(randomLetters(97), "Uniform random · 97 letters", { cols: 14, width: 445, height: 280 });
      if (type === "alphabet") addGrid(KRYPTOS_ALPHABET, "Kryptos alphabet", { cols: 13, width: 415, height: 145 });
      if (type === "crib-east") addGrid("EASTNORTHEAST", "K4 crib · EASTNORTHEAST", { cols: 13, width: 420, height: 115 });
      if (type === "crib-berlin") addGrid("BERLINCLOCK", "K4 crib · BERLINCLOCK", { cols: 11, width: 355, height: 115 });
      if (type === "positional") addGrid(positionalK4Cribs(), "K4 positional crib mask", { cols: 14, width: 445, height: 280, preserveSparse: true });
    }));
    $("#renameWorkspace").addEventListener("click", () => { const entry = state.workspaces.find(item => item.id === state.activeWorkspaceId); if (entry) renameWorkspaceEntry(entry); });
    $("#addWorkspace").addEventListener("click", () => createWorkspace());
    $("#libraryEditor").addEventListener("submit", event => {
      event.preventDefault();
      const name = $("#libraryEditorInput").value.trim();
      if (!name) {
        toast("Enter a name");
        $("#libraryEditorInput").focus();
        return;
      }
      const commit = libraryEditorCommit;
      closeLibraryEditor();
      commit?.(name);
    });
    $("#cancelLibraryEditor").addEventListener("click", closeLibraryEditor);
    $("#libraryEditorInput").addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeLibraryEditor();
      }
    });

    document.addEventListener("pointerdown", event => {
      finishAppendTyping();
      if (!event.target.closest(".clone-extend-control")) closeCloneExtend();
    }, { capture: true });
    document.addEventListener("keydown", event => {
      const command = event.ctrlKey || event.metaKey;
      const appendKey = !command && !event.altKey && event.key.length === 1 && /^[A-Z?]$/i.test(event.key);
      if (!appendKey && event.key !== "Backspace") finishAppendTyping();
      if (command && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if (command && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
      if (event.key === "Escape") {
        if (!$("#contextMenu").classList.contains("hidden")) { event.preventDefault(); closeContextMenu(); return; }
        if (!$("#libraryEditor").classList.contains("hidden")) { event.preventDefault(); closeLibraryEditor(); return; }
        if (!$("#helpModal").classList.contains("hidden")) { event.preventDefault(); $("#closeHelp").click(); return; }
        if (!$("#aboutModal").classList.contains("hidden")) { event.preventDefault(); $("#closeAbout").click(); return; }
        if (!$("#cloneExtendPopover").classList.contains("hidden")) { event.preventDefault(); closeCloneExtend(); return; }
      }
      if (document.activeElement.matches("input, textarea, select, button, a, [contenteditable='true']")) return;
      if (event.key === "Escape") {
        if (clearAllCellSelections()) event.preventDefault();
        return;
      }
      if (command && event.key.toLowerCase() === "a") {
        if (selectAllGridCells()) event.preventDefault();
        return;
      }
      if (!command && !event.altKey && event.key.startsWith("Arrow")) {
        if (nudgeCurrentGrid(event.key, event.shiftKey ? 5 : 1)) event.preventDefault();
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        if (!deleteSelectedLetters()) removeLastLetterFromCurrentGrid();
        return;
      }
      if (event.key === "Delete") {
        event.preventDefault();
        if (!deleteSelectedLetters()) deleteGrid();
        return;
      }
      if (!command && !event.altKey && event.key.length === 1 && /^[A-Z?]$/i.test(event.key)) {
        if (typeIntoSelection(event.key)) {
          event.preventDefault();
          return;
        }
        if (appendLetterToCurrentGrid(event.key)) {
          event.preventDefault();
          return;
        }
      }
      if (event.key.toLowerCase() === "v") $(".tool-button[data-mode='select']").click();
      if (event.key.toLowerCase() === "h") $(".tool-button[data-mode='pan']").click();
    });
    document.addEventListener("copy", event => {
      if (document.activeElement.matches("input, textarea, select, [contenteditable='true']")) {
        copiedGridClipboard = null;
        return;
      }
      const grid = currentGrid();
      if (!grid) return;
      event.preventDefault();
      const selectedGrids = state.selectedGridIds.map(id => state.grids.find(item => item.id === id)).filter(Boolean);
      const copyingWholeGrids = selectedGrids.length > 1 || !grid.selected.size;
      const plainText = selectedGrids.length > 1
        ? selectedGrids.map(formatWholeGridForClipboard).join("\n\n")
        : formatGridForClipboard(grid);
      event.clipboardData.setData("text/plain", plainText);
      if (copyingWholeGrids) {
        const bundle = createGridBundle(state.grids, selectedGrids.map(item => item.id), state.overlays);
        copiedGridClipboard = { bundle, plainText };
        try { event.clipboardData.setData(GRID_BUNDLE_MIME, JSON.stringify(bundle)); } catch {}
        if (selectedGrids.length === 1) {
          try { event.clipboardData.setData("application/x-kryptos-grid", JSON.stringify(bundle.grids[0])); } catch {}
        }
        toast(`Copied ${selectedGrids.length} grid${selectedGrids.length === 1 ? "" : "s"} · paste to duplicate`);
      } else {
        copiedGridClipboard = null;
        toast(grid.selected.size ? `Copied ${grid.selected.size} selected letters` : `Copied ${grid.cols} × ${Math.ceil(grid.text.length / grid.cols)} grid`);
      }
    });
    document.addEventListener("paste", event => {
      if (document.activeElement.matches("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      const plainText = event.clipboardData.getData("text/plain");
      let clipboardBundle = null;
      let clipboardGrid = null;
      try {
        const structuredBundle = event.clipboardData.getData(GRID_BUNDLE_MIME);
        if (structuredBundle) clipboardBundle = JSON.parse(structuredBundle);
        const structured = event.clipboardData.getData("application/x-kryptos-grid");
        if (structured) clipboardGrid = JSON.parse(structured);
      } catch {}
      const normalizedPlainText = plainText.replaceAll("\r\n", "\n");
      const internalMatch = copiedGridClipboard?.plainText.replaceAll("\r\n", "\n") === normalizedPlainText;
      if (!clipboardBundle && internalMatch) clipboardBundle = copiedGridClipboard.bundle;
      if (clipboardBundle?.grids?.length && pasteGridBundle(clipboardBundle)) return;
      if (clipboardGrid?.text && Number.isFinite(Number(clipboardGrid.cols))) {
        duplicateGrid(clipboardGrid);
        return;
      }
      copiedGridClipboard = null;
      pasteIntoGrid(plainText);
    });
    window.addEventListener("pagehide", () => persistWorkspaceLibraryNow({ notify: false }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") persistWorkspaceLibraryNow({ notify: false });
    });
  }

  function enableLiveReload() {
    const developmentHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (!developmentHosts.has(location.hostname)) return;
    const sources = ["index.html", "styles.css", "app.js", "modules/cipher.js", "modules/overlay.js", "modules/analysis.js", "modules/transposition-analysis.js", "modules/grid-analysis.js", "modules/grid-clipboard.js", "modules/grid-resize.js", "modules/viewport.js", "modules/persistence.js", "modules/utils.js", "modules/matrix.js", "modules/context-menu.js"];
    let baseline = null;
    const fingerprint = async () => {
      const parts = await Promise.all(sources.map(async source => {
        const response = await fetch(source, { method: "HEAD", cache: "no-store" });
        return `${source}:${response.headers.get("last-modified") || ""}:${response.headers.get("content-length") || ""}`;
      }));
      return parts.join("|");
    };
    fingerprint().then(value => { baseline = value; }).catch(() => {});
    setInterval(async () => {
      try {
        const current = await fingerprint();
        if (baseline && current !== baseline) {
          saveActiveWorkspaceState();
          sessionStorage.setItem("kryptos-live-reload", JSON.stringify({
            current: captureSnapshot(),
            history: state.history,
            future: state.future,
            library: serializeWorkspaceLibrary(),
          }));
          location.reload();
        }
        baseline = current;
      } catch { /* The development server may be restarting. */ }
    }, 750);
  }

  function restoreLiveReloadSession() {
    try {
      const raw = sessionStorage.getItem("kryptos-live-reload");
      if (!raw) return false;
      sessionStorage.removeItem("kryptos-live-reload");
      const saved = JSON.parse(raw);
      state.history = saved.history || [];
      state.future = saved.future || [];
      if (saved.library) {
        state.folders = saved.library.folders || [];
        state.workspaces = saved.library.workspaces || [];
        state.activeWorkspaceId = saved.library.activeWorkspaceId;
        state.activeFolderId = saved.library.activeFolderId;
      }
      restoreSnapshot(saved.current);
      if (!state.folders.length) initializeWorkspaceLibrary();
      else renderWorkspaceTree();
      return true;
    } catch {
      sessionStorage.removeItem("kryptos-live-reload");
      return false;
    }
  }

  bindUi();
  if (!restoreLiveReloadSession()) {
    if (!loadWorkspaceLibrary()) {
      if (!loadSnapshot()) state.grids = samples.map(grid => ({ ...grid, selected: new Set() }));
      state.selectedGridId ||= state.grids[0]?.id || null;
      if (!state.selectedGridIds.length && state.selectedGridId) state.selectedGridIds = [state.selectedGridId];
      renderAll();
      initializeWorkspaceLibrary();
    }
  }
  setStatus("Workspace ready — drag a grid header to begin");
  updateHistoryControls();
  enableLiveReload();
})();
