import {
  KRYPTOS_ALPHABET, NORMAL_ALPHABET, K1_CIPHERTEXT, K2_CIPHERTEXT, K3_CIPHERTEXT, K4_CIPHERTEXT, GRID_OPERATIONS,
  cleanText, cleanUnique, positionalK4Cribs, randomEnglishBookSample, combineCipherLetters, combineCipherText,
} from "./modules/cipher.js";
import {
  letterCounts, indexOfCoincidence, frequencySimilarity, estimateNulls, formatPercent,
  scanVigenerePeriods, suggestVigenereKey, decryptVigenere, coincidenceSignificance, formatPValue,
} from "./modules/analysis.js";
import { uniqueId, clamp, escapeHtml } from "./modules/utils.js";
import { transformSparseText } from "./modules/matrix.js";
import { createContextMenuController } from "./modules/context-menu.js";
import { scanModularRoutes, bestNgramRouteOffset } from "./modules/transposition-analysis.js";

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

  function refreshSynchronizedViews() {
    state.grids.forEach(grid => {
      if (!grid.syncSourceId) return;
      const source = synchronizedRoot(grid);
      if (!source || source.id === grid.id) return;
      grid.text = source.text;
      grid.selected = new Set([...grid.selected].filter(index => index < grid.text.length));
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

  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("visible");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("visible"), 1900);
  }

  function captureSnapshot() {
    return {
      grids: state.grids.map(grid => ({ ...grid, derived: grid.derived ? { ...grid.derived } : null, selected: [...grid.selected] })),
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
    state.grids = snapshot.grids.map(grid => ({ ...grid, derived: grid.derived ? { ...grid.derived } : null, selected: new Set(grid.selected || []) }));
    state.overlays = (snapshot.overlays || []).map(overlay => ({ ...overlay }));
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

  function saveActiveWorkspaceState() {
    if (!state.activeWorkspaceId) return;
    const workspaceEntry = state.workspaces.find(item => item.id === state.activeWorkspaceId);
    if (!workspaceEntry) return;
    workspaceEntry.name = $("#workspaceTitle").textContent;
    workspaceEntry.document = cloneSerializable(captureSnapshot());
    workspaceEntry.history = cloneSerializable(state.history);
    workspaceEntry.future = cloneSerializable(state.future);
  }

  function initializeWorkspaceLibrary() {
    state.folders = [
      { id: "folder-kryptos", name: "Kryptos", open: true },
      { id: "folder-classical", name: "Classical ciphers", open: true },
      { id: "folder-archive", name: "Archive", open: false },
    ];
    const activeId = uniqueId("workspace");
    state.activeWorkspaceId = activeId;
    state.activeFolderId = "folder-kryptos";
    state.workspaces = [
      { id: activeId, folderId: "folder-kryptos", name: $("#workspaceTitle").textContent, document: cloneSerializable(captureSnapshot()), history: [], future: [] },
      { id: uniqueId("workspace"), folderId: "folder-kryptos", name: "K3 Reconstruction", document: emptyWorkspaceDocument("K3 Reconstruction"), history: [], future: [] },
      { id: uniqueId("workspace"), folderId: "folder-kryptos", name: "Berlin clock notes", document: emptyWorkspaceDocument("Berlin clock notes"), history: [], future: [] },
      { id: uniqueId("workspace"), folderId: "folder-kryptos", name: "Vigenère experiments", document: emptyWorkspaceDocument("Vigenère experiments"), history: [], future: [] },
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

  function createWorkspace(folderId = state.activeFolderId || state.folders[0]?.id, proposedName = "Untitled workspace") {
    const name = prompt("Workspace name", proposedName);
    if (!name?.trim()) return;
    saveActiveWorkspaceState();
    const entry = { id: uniqueId("workspace"), folderId, name: name.trim(), document: emptyWorkspaceDocument(name.trim()), history: [], future: [] };
    state.workspaces.push(entry);
    const folder = state.folders.find(item => item.id === folderId);
    if (folder) folder.open = true;
    switchWorkspace(entry.id);
  }

  function renameWorkspaceEntry(entry) {
    const name = prompt("Workspace name", entry.name);
    if (!name?.trim()) return;
    entry.name = name.trim();
    if (entry.id === state.activeWorkspaceId) $("#workspaceTitle").textContent = entry.name;
    if (entry.document) entry.document.workspaceTitle = entry.name;
    renderWorkspaceTree();
    scheduleLibraryPersistence();
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
  function scheduleLibraryPersistence() {
    if (!state.activeWorkspaceId) return;
    clearTimeout(librarySaveTimer);
    librarySaveTimer = setTimeout(() => {
      saveActiveWorkspaceState();
      const library = { folders: state.folders, workspaces: state.workspaces, activeWorkspaceId: state.activeWorkspaceId, activeFolderId: state.activeFolderId };
      localStorage.setItem("kryptos-workspace-library", JSON.stringify(library));
    }, 120);
  }

  function loadWorkspaceLibrary() {
    try {
      const raw = localStorage.getItem("kryptos-workspace-library");
      if (!raw) return false;
      const library = JSON.parse(raw);
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
      return true;
    } catch { return false; }
  }

  function renderAll() {
    migrateLegacyK4Imports();
    state.grids.forEach(grid => { grid.cellSize = state.cellSize; });
    refreshSynchronizedViews();
    refreshDerivedGrids();
    refreshSynchronizedViews();
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
    const rightEdge = state.grids.reduce((maximum, grid) => Math.max(maximum, grid.x + grid.width * state.zoom), 0);
    const bottomEdge = state.grids.reduce((maximum, grid) => Math.max(maximum, grid.y + grid.height * state.zoom), 0);
    const layer = $(".workspace-grid", workspace);
    layer.style.width = `${Math.max(2400, workspace.clientWidth, Math.ceil(rightEdge + margin))}px`;
    layer.style.height = `${Math.max(1600, workspace.clientHeight, Math.ceil(bottomEdge + margin))}px`;
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

  function renderGrid(grid) {
    const card = document.createElement("article");
    const operandIndex = state.selectedGridIds.indexOf(grid.id);
    const isOverlayTop = state.overlays.some(overlay => overlay.overlayId === grid.id);
    card.className = `grid-card${operandIndex >= 0 ? " selected" : ""}${grid.id === state.selectedGridId ? " primary" : ""}${isOverlayTop ? " overlay-top" : ""}`;
    card.dataset.id = grid.id;
    if (operandIndex >= 0) card.dataset.operand = String.fromCharCode(65 + operandIndex);
    const minimumWidth = grid.cellSize + 20;
    const contentHeight = gridMinimumHeight(grid);
    const minimumHeight = gridMinimumHeightForRows(grid, 1);
    grid.width = Math.max(grid.width, minimumWidth);
    grid.height = Math.max(grid.height, contentHeight);
    card.style.cssText = `left:${grid.x}px;top:${grid.y}px;width:${grid.width}px;height:${grid.height}px;min-width:${minimumWidth}px;min-height:${minimumHeight}px;z-index:${grid.z || 1}`;
    card.innerHTML = `
      <div class="grid-card-header">
        <span class="grid-grip">⠿</span>
        <span class="grid-card-title">${escapeHtml(grid.name)}</span>
        ${grid.syncSourceId ? '<span class="sync-badge">SYNC</span>' : ""}
        ${(grid.derived || state.overlays.some(overlay => overlay.overlayId === grid.id)) ? '<span class="live-badge">LIVE</span>' : ""}
        <span class="grid-dimensions">${grid.cols} × ${Math.ceil(grid.text.length / grid.cols)}</span>
        <button class="grid-menu" title="Grid options">•••</button>
      </div>
      <div class="grid-card-body">
        <div class="letter-grid" style="grid-template-columns:repeat(${grid.cols}, ${grid.cellSize}px)"></div>
      </div>
      <div class="grid-resize-handle" title="Resize and reshape grid" aria-label="Resize grid"></div>`;
    const letterGrid = $(".letter-grid", card);
    [...grid.text].forEach((letter, index) => {
      const cell = document.createElement("div");
      const isEmpty = !letter || letter === " ";
      const isUnknown = letter === "?";
      cell.className = `letter-cell${isEmpty ? " empty" : ""}${isUnknown ? " unknown" : ""}${grid.selected.has(index) ? " selected" : ""}`;
      cell.dataset.index = index;
      cell.style.width = `${grid.cellSize}px`;
      cell.style.height = `${grid.cellSize}px`;
      cell.textContent = letter;
      if ($("#showIndices").checked && !isEmpty) {
        const alphabetIndex = state.alphabet.indexOf(letter);
        const value = alphabetIndex < 0 ? "–" : alphabetIndex;
        cell.insertAdjacentHTML("beforeend", `<span class="cell-index">${value}</span>`);
      }
      letterGrid.appendChild(cell);
    });
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
    const start = { x: event.clientX, y: event.clientY, width: grid.width, height: grid.height };
    const compactText = grid.text.includes(" ") ? grid.text.replaceAll(" ", "") : grid.text;
    let mode = null;
    let changed = false;
    card.classList.add("resizing");
    card.setPointerCapture?.(event.pointerId);

    const reshape = columns => {
      const nextColumns = clamp(columns, 1, 500);
      if (nextColumns === grid.cols && grid.text === compactText) return;
      grid.text = compactText;
      grid.cols = nextColumns;
      grid.width = gridWidthForColumns(grid, nextColumns);
      grid.height = gridMinimumHeight(grid);
      card.style.width = `${grid.width}px`;
      card.style.height = `${grid.height}px`;
      letterGrid.style.gridTemplateColumns = `repeat(${grid.cols}, ${grid.cellSize}px)`;
      $(".grid-dimensions", card).textContent = `${grid.cols} × ${Math.ceil(grid.text.length / grid.cols)}`;
      if (grid.id === state.selectedGridId) $("#gridColumns").value = grid.cols;
      setStatus(`Reshaped ${grid.name} to ${grid.cols} × ${Math.ceil(grid.text.length / grid.cols)}`);
      changed = true;
    };

    const move = moveEvent => {
      const dx = (moveEvent.clientX - start.x) / state.zoom;
      const dy = (moveEvent.clientY - start.y) / state.zoom;
      if (!mode) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
        mode = Math.abs(dx) >= Math.abs(dy) ? "width" : "height";
        card.dataset.resizeMode = mode;
      }
      if (mode === "width") {
        const targetWidth = Math.max(gridWidthForColumns(grid, 1), start.width + dx);
        const columns = Math.floor((targetWidth - 18 + 2) / (grid.cellSize + 2));
        reshape(columns);
      } else {
        const targetHeight = Math.max(gridMinimumHeightForRows(grid, 1), start.height + dy);
        const requestedRows = clamp(
          Math.floor((targetHeight - 54 + 2) / (grid.cellSize + 2)),
          1,
          Math.max(1, compactText.length),
        );
        reshape(Math.ceil(compactText.length / requestedRows));
      }
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
      else if (!alreadySelected) state.selectedGridIds = [...state.selectedGridIds.slice(-1), id];
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
      if (index >= 0) card.dataset.operand = String.fromCharCode(65 + index);
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

    const updatePosition = (clientX, clientY) => {
      const scale = state.zoom;
      const scrollDeltaX = workspace.scrollLeft - start.scrollLeft;
      const scrollDeltaY = workspace.scrollTop - start.scrollTop;
      grid.x = Math.max(0, Math.round((start.x + (clientX - start.clientX) / scale + scrollDeltaX) / 8) * 8);
      grid.y = Math.max(0, Math.round((start.y + (clientY - start.clientY) / scale + scrollDeltaY) / 8) * 8);
      card.style.left = `${grid.x}px`;
      card.style.top = `${grid.y}px`;
      updateWorkspaceExtent();
      const target = findOverlapTarget(grid, card, true);
      $$(".grid-card.preview-a, .grid-card.preview-b, .grid-card.drop-target", workspace).forEach(element => element.classList.remove("preview-a", "preview-b", "drop-target"));
      card.classList.add("preview-a");
      if (target) $(`.grid-card[data-id="${target.id}"]`, workspace)?.classList.add("preview-b");
      renderLiveOverlay(target, grid, card);
    };
    const move = moveEvent => {
      latestPointer = { clientX: moveEvent.clientX, clientY: moveEvent.clientY };
      updatePosition(latestPointer.clientX, latestPointer.clientY);
    };
    const scroll = () => updatePosition(latestPointer.clientX, latestPointer.clientY);
    const end = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      workspace.removeEventListener("scroll", scroll);
      card.classList.remove("dragging");
      $$(".grid-card.preview-a, .grid-card.preview-b, .grid-card.drop-target", workspace).forEach(element => element.classList.remove("preview-a", "preview-b", "drop-target"));
      clearLiveOverlay();
      const target = findOverlapTarget(grid, card);
      state.moving = null;
      if (target && $("#snapCombine").checked) {
        activateLiveOverlay(target, grid);
        commitHistory(historyBefore, `overlay ${grid.name} on ${target.name}`);
      } else {
        const overlayCount = state.overlays.length;
        state.overlays = state.overlays.filter(overlay => overlay.overlayId !== grid.id);
        if (overlayCount !== state.overlays.length) renderAll();
        commitHistory(historyBefore, `move ${grid.name}`);
        setStatus(`Moved ${grid.name}`);
      }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end, { once: true });
    workspace.addEventListener("scroll", scroll, { passive: true });
  }

  function findOverlapTarget(grid, card, preview = false) {
    const a = card.getBoundingClientRect();
    let best = null;
    let bestArea = 0;
    state.grids.forEach(candidate => {
      if (candidate.id === grid.id) return;
      const element = $(`.grid-card[data-id="${candidate.id}"]`, workspace);
      if (!element) return;
      const b = element.getBoundingClientRect();
      const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const area = width * height;
      const threshold = preview ? Math.min(grid.cellSize, candidate.cellSize) ** 2 * .3 : Math.min(a.width * a.height, b.width * b.height) * 0.28;
      if (area > threshold && area > bestArea) { best = candidate; bestArea = area; }
    });
    return best;
  }

  function clearLiveOverlay() {
    $$(".letter-cell.live-overlay", workspace).forEach(cell => {
      cell.classList.remove("live-overlay");
      delete cell.dataset.liveLetter;
      delete cell.dataset.liveFormula;
      cell.removeAttribute("title");
    });
  }

  function renderLiveOverlay(base, overlay, overlayCard) {
    clearLiveOverlay();
    if (!base) return;
    const baseCard = $(`.grid-card[data-id="${base.id}"]`, workspace);
    if (!baseCard) return;
    const baseCells = $$(".letter-cell", baseCard).map((cell, index) => ({ cell, index, rect: cell.getBoundingClientRect() }));
    const overlayCells = $$(".letter-cell", overlayCard);
    overlayCells.forEach((cell, overlayIndex) => {
      const movingRect = cell.getBoundingClientRect();
      let best = null, bestArea = 0;
      baseCells.forEach(candidate => {
        const width = Math.max(0, Math.min(movingRect.right, candidate.rect.right) - Math.max(movingRect.left, candidate.rect.left));
        const height = Math.max(0, Math.min(movingRect.bottom, candidate.rect.bottom) - Math.max(movingRect.top, candidate.rect.top));
        const area = width * height;
        if (area > bestArea) { best = candidate; bestArea = area; }
      });
      if (!best || bestArea < Math.min(movingRect.width * movingRect.height, best.rect.width * best.rect.height) * .35) return;
      const letter = combineLetters(overlay.text[overlayIndex], base.text[best.index], $("#combineOperation").value);
      cell.dataset.liveLetter = letter;
      cell.dataset.liveFormula = `A:${overlay.text[overlayIndex]}${$("#combineOperation").value === "subtract" ? "−" : "+"}B:${base.text[best.index]}`;
      cell.title = `A: ${overlay.text[overlayIndex]} ${$("#combineOperation").value === "subtract" ? "minus" : "plus"} B: ${base.text[best.index]} = ${letter}`;
      cell.classList.add("live-overlay");
    });
  }

  function activateLiveOverlay(base, overlay) {
    const stride = state.cellSize + 2;
    let columnOffset = Math.round((overlay.x - base.x) / stride);
    let rowOffset = Math.round((overlay.y - base.y) / stride);
    if (base.x + columnOffset * stride < 0) columnOffset = Math.ceil(-base.x / stride);
    if (base.y + rowOffset * stride < 0) rowOffset = Math.ceil(-base.y / stride);
    overlay.x = base.x + columnOffset * stride;
    overlay.y = base.y + rowOffset * stride;
    overlay.z = ++state.z;
    state.selectedGridIds = [overlay.id, base.id];
    state.selectedGridId = overlay.id;
    state.overlays = state.overlays.filter(link => link.overlayId !== overlay.id);
    state.overlays.push({
      id: uniqueId("live-overlay"),
      baseId: base.id,
      overlayId: overlay.id,
      rowOffset,
      columnOffset,
      operation: $("#combineOperation").value,
    });
    renderAll();
    const overlap = countOverlayCells(base, overlay, rowOffset, columnOffset);
    setStatus(`Live overlay: ${overlap} aligned cell${overlap === 1 ? "" : "s"}`);
    toast(`A: ${overlay.name} · B: ${base.name}`);
  }

  function countOverlayCells(base, overlay, rowOffset, columnOffset) {
    const baseRows = Math.ceil(base.text.length / base.cols);
    let count = 0;
    for (let index = 0; index < overlay.text.length; index++) {
      const row = Math.floor(index / overlay.cols) + rowOffset;
      const column = index % overlay.cols + columnOffset;
      const baseIndex = row * base.cols + column;
      if (row >= 0 && row < baseRows && column >= 0 && column < base.cols && baseIndex < base.text.length) count++;
    }
    return count;
  }

  function renderPersistentOverlays() {
    state.overlays.forEach(link => {
      const base = state.grids.find(grid => grid.id === link.baseId);
      const overlay = state.grids.find(grid => grid.id === link.overlayId);
      const overlayCard = $(`.grid-card[data-id="${link.overlayId}"]`, workspace);
      if (!base || !overlay || !overlayCard) return;
      const cells = $$(".letter-cell", overlayCard);
      for (let overlayIndex = 0; overlayIndex < overlay.text.length; overlayIndex++) {
        const baseRow = Math.floor(overlayIndex / overlay.cols) + link.rowOffset;
        const baseColumn = overlayIndex % overlay.cols + link.columnOffset;
        const baseIndex = baseRow * base.cols + baseColumn;
        if (baseRow < 0 || baseColumn < 0 || baseColumn >= base.cols || baseIndex < 0 || baseIndex >= base.text.length) continue;
        const cell = cells[overlayIndex];
        if (!cell) continue;
        cell.dataset.liveLetter = combineLetters(overlay.text[overlayIndex], base.text[baseIndex], link.operation);
        cell.dataset.liveFormula = `A:${overlay.text[overlayIndex]}${link.operation === "subtract" ? "−" : "+"}B:${base.text[baseIndex]}`;
        cell.title = `A: ${overlay.text[overlayIndex]} ${link.operation === "subtract" ? "minus" : "plus"} B: ${base.text[baseIndex]} = ${cell.dataset.liveLetter}`;
        cell.classList.add("live-overlay");
      }
    });
  }

  function combineLetters(a, b, operation, alphabet = state.alphabet) {
    return combineCipherLetters(a, b, operation, alphabet);
  }

  function combinedText(base, overlay, operation) {
    return combineCipherText(base, overlay, operation, state.alphabet);
  }

  function refreshDerivedGrids() {
    state.grids.forEach(grid => {
      if (!grid.derived) return;
      const base = state.grids.find(item => item.id === grid.derived.baseId);
      const overlay = state.grids.find(item => item.id === grid.derived.overlayId);
      if (!base || !overlay) return;
      grid.text = combinedText(base, overlay, grid.derived.operation);
      grid.cols = Math.min(base.cols, overlay.cols);
      grid.cellSize = Math.min(base.cellSize, overlay.cellSize);
    });
  }

  function beginCellSelection(event, grid, card) {
    const cell = event.target.closest(".letter-cell");
    if (!cell || event.button !== 0 || state.tool !== "select") return;
    event.preventDefault();
    event.stopPropagation();
    const historyBefore = captureSnapshot();
    selectGrid(grid.id, true);
    const anchor = Number(cell.dataset.index);
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
    return $(`.letter-cell[data-index="${index}"]`, card);
  }

  function gridMinimumHeight(grid) {
    const rows = Math.max(1, Math.ceil(grid.text.length / grid.cols));
    return gridMinimumHeightForRows(grid, rows);
  }

  function gridMinimumHeightForRows(grid, rows) {
    const headerHeight = 34;
    const bodyPaddingAndBorders = 20;
    const cellGap = 2;
    const gridHeight = rows * grid.cellSize + Math.max(0, rows - 1) * cellGap;
    return headerHeight + bodyPaddingAndBorders + gridHeight;
  }

  function gridWidthForColumns(grid, columns) {
    const bodyPaddingAndBorders = 20;
    const cellGap = 2;
    return bodyPaddingAndBorders + columns * grid.cellSize + Math.max(0, columns - 1) * cellGap;
  }

  function fitGridCardToContent(grid) {
    grid.width = gridWidthForColumns(grid, grid.cols);
    grid.height = gridMinimumHeight(grid);
  }

  function combineGrids(base, overlay) {
    const alphabet = state.alphabet;
    if (alphabet.length < 2) return toast("Choose an alphabet with at least two unique symbols");
    const operation = $("#combineOperation").value;
    const definition = GRID_OPERATIONS[operation] || GRID_OPERATIONS.add;
    const length = Math.min(base.text.length, overlay.text.length);
    const text = combinedText(base, overlay, operation);
    const resultPosition = positionInsideViewport(
      Math.max(220, Math.min(base.width, overlay.width)),
      Math.max(150, Math.min(base.height, overlay.height)),
      Math.round((Math.max(base.x, overlay.x) + 24) / 8) * 8,
      Math.round((Math.max(base.y, overlay.y) + 48) / 8) * 8,
    );
    const result = {
      id: uniqueId("operation"), name: `${base.name} ${definition.symbol} ${overlay.name}`,
      text, cols: Math.min(base.cols, overlay.cols), cellSize: Math.min(base.cellSize, overlay.cellSize),
      x: resultPosition.x,
      y: resultPosition.y,
      width: Math.max(220, Math.min(base.width, overlay.width)), height: Math.max(150, Math.min(base.height, overlay.height)),
      selected: new Set(), z: ++state.z,
      derived: { baseId: base.id, overlayId: overlay.id, operation }
    };
    state.grids.push(result);
    state.selectedGridId = result.id;
    state.selectedGridIds = [result.id];
    renderAll();
    $(`.grid-card[data-id="${result.id}"]`, workspace)?.classList.add("combine-flash");
    setStatus(`Combined ${length} letters using ${operation}`);
    toast(`Created ${result.name}`);
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
      selected: new Set(), z: ++state.z
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

  function duplicateGrid() {
    const source = currentGrid();
    if (!source) return;
    const historyBefore = captureSnapshot();
    const position = positionInsideViewport(source.width, source.height, source.x + 32, source.y + 32);
    const copy = { ...source, id: uniqueId(), name: `${source.name} copy`, x: position.x, y: position.y, selected: new Set(), z: ++state.z };
    if (copy.derived) copy.derived = { ...copy.derived };
    state.grids.push(copy);
    state.selectedGridId = copy.id;
    state.selectedGridIds = [copy.id];
    renderAll();
    commitHistory(historyBefore, `duplicate ${source.name}`);
    toast("Grid duplicated");
  }

  function deleteGrid() {
    const grid = currentGrid();
    if (!grid) return;
    const historyBefore = captureSnapshot();
    state.grids.forEach(item => { if (item.syncSourceId === grid.id) item.syncSourceId = null; });
    const removedIds = new Set([grid.id]);
    state.grids.forEach(item => {
      if (item.derived && (item.derived.baseId === grid.id || item.derived.overlayId === grid.id)) removedIds.add(item.id);
    });
    state.grids = state.grids.filter(item => !removedIds.has(item.id));
    state.overlays = state.overlays.filter(overlay => !removedIds.has(overlay.baseId) && !removedIds.has(overlay.overlayId));
    state.selectedGridId = state.grids.at(-1)?.id || null;
    state.selectedGridIds = state.selectedGridId ? [state.selectedGridId] : [];
    renderAll();
    commitHistory(historyBefore, `delete ${grid.name}`);
    toast(`Deleted ${grid.name}`);
  }

  function transformGrid(kind) {
    const grid = currentGrid();
    if (!grid) return;
    const historyBefore = captureSnapshot();
    const detachedSynchronizedView = Boolean(grid.syncSourceId);
    if (detachedSynchronizedView) grid.syncSourceId = null;
    if (grid.derived) grid.derived = null;
    const transformed = transformSparseText(grid.text, grid.cols, kind);
    grid.text = transformed.text;
    grid.cols = transformed.columns;
    fitGridCardToContent(grid);
    grid.selected.clear();
    renderAll();
    commitHistory(historyBefore, `${kind === "transpose" ? "transpose" : "rotate"} ${grid.name}`);
    toast(`${kind === "transpose" ? "Transposed" : "Rotated"} ${grid.name}${detachedSynchronizedView ? " · synchronized link detached" : ""}`);
  }

  function updateInspector() {
    const grid = currentGrid();
    state.selectedGridIds = state.selectedGridIds.filter(id => state.grids.some(item => item.id === id)).slice(0, 2);
    const operands = state.selectedGridIds.map(id => state.grids.find(item => item.id === id)).filter(Boolean);
    $("#operandA").textContent = operands[0]?.name || "Select first grid";
    $("#operandB").textContent = operands[1]?.name || "Select second grid";
    $("#runGridOperation").disabled = operands.length !== 2;
    const controls = [$("#gridName"), $("#gridColumns"), $("#cellSize"), $("#gridText")];
    controls.forEach(control => control.disabled = !grid);
    $("#gridName").value = grid?.name || "Select a grid";
    $("#gridColumns").value = grid?.cols || "";
    $("#cellSize").value = grid?.cellSize || "";
    $("#gridText").value = grid?.text || "";
    updateAlphabetPreview();
    updateAnalysis();
  }

  function selectedSequence() {
    const grid = currentGrid();
    if (!grid) return "";
    if (!grid.selected.size) return grid.text;
    return orderedSelectionIndices(grid).map(index => grid.text[index]).join("");
  }

  function orderedSelectionIndices(grid) {
    const indices = [...grid.selected];
    if (grid.selectionOrientation !== "vertical") return indices.sort((a, b) => a - b);
    const rows = Math.ceil(grid.text.length / grid.cols);
    return indices.sort((a, b) => {
      const aOrdinal = (a % grid.cols) * rows + Math.floor(a / grid.cols);
      const bOrdinal = (b % grid.cols) * rows + Math.floor(b / grid.cols);
      return aOrdinal - bOrdinal;
    });
  }

  function updateAnalysis() {
    const sequence = selectedSequence().replace(/[^A-Z]/g, "");
    const grid = currentGrid();
    $("#analyseAll").textContent = grid?.selected.size ? "Clear selection" : "Full grid";
    $("#analyseAll").disabled = !grid?.selected.size;
    $("#analysisSequence").textContent = sequence || "—";
    $("#analysisLength").textContent = `${sequence.length} character${sequence.length === 1 ? "" : "s"}`;
    if ($("#analysisPanel").classList.contains("active")) scheduleModularStrideScan(sequence);
    if (sequence.length < 2) {
      $("#icValue").textContent = "—";
      $("#freqFit").textContent = "—";
      $("#icPValue").textContent = "—";
      $("#icReliability").textContent = "—";
      $("#freqPValue").textContent = "—";
      $("#icMeter").style.width = "0";
      $("#freqMeter").style.width = "0";
      $("#frequencyChart").innerHTML = '<div class="chart-placeholder">Select letters to analyse</div>';
      $("#bigramList").innerHTML = "<span>—</span>";
      $("#periodScanList").innerHTML = '<div class="chart-placeholder">Select enough letters to scan</div>';
      $("#periodDetail").classList.add("hidden");
      return;
    }

    const counts = letterCounts(sequence);
    const ic = indexOfCoincidence(counts, sequence.length);
    const icSignificance = coincidenceSignificance(ic, sequence.length, state.alphabet.length || 26);
    const fit = frequencySimilarity(counts, sequence.length);
    const nulls = estimateNulls(sequence.length, ic, fit);
    $("#icValue").textContent = ic.toFixed(4);
    $("#freqFit").textContent = `${fit.toFixed(1)}%`;
    $("#icPValue").textContent = formatPValue(icSignificance.pValue);
    $("#icReliability").textContent = `${icSignificance.standardError.toFixed(4)} · ${icSignificance.zScore.toFixed(1)}σ`;
    $("#freqPValue").textContent = formatPercent(nulls.fit);
    $("#icMeter").style.width = `${clamp(ic / .1 * 100, 0, 100)}%`;
    $("#freqMeter").style.width = `${clamp(fit, 0, 100)}%`;
    renderFrequencyChart(counts, sequence.length);
    renderBigrams(sequence);
    renderPeriodScan(sequence);
  }

  function renderPeriodScan(sequence) {
    const maximum = Math.min(Number($("#periodScanMax").value), Math.max(1, Math.floor(sequence.length / 2)));
    $("#periodScanMaxValue").textContent = maximum;
    const scan = scanVigenerePeriods(sequence, maximum, state.alphabet.length || 26);
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
    $("#selectionCount").textContent = state.selectedGridIds.length > 1 ? `${state.selectedGridIds.length} operand grids selected` : grid?.selected.size ? `${grid.selected.size} cells selected` : "No cell selection";
  }

  function setStatus(message) {
    $("#statusText").textContent = message;
    updateStatus();
  }

  function applyZoom() {
    $$(".grid-card", workspace).forEach(card => card.style.transform = `scale(${state.zoom})`);
    $("#zoomLabel").textContent = `${Math.round(state.zoom * 100)}%`;
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
    if (grid.selected.size) return orderedSelectionIndices(grid).map(index => grid.text[index]).join("");
    const rows = [];
    for (let index = 0; index < grid.text.length; index += grid.cols) rows.push(grid.text.slice(index, index + grid.cols));
    return rows.join("\n");
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

  function editLetterAt(grid, index, mode) {
    let letter = "";
    if (mode !== "delete") {
      const response = prompt(`${mode === "replace" ? "Replace with" : "Insert"} letter`, grid.text[index] || "A");
      if (response == null) return;
      letter = cleanText(response)[0];
      if (!letter) return toast("Enter one letter or ? for an unknown slot");
    }
    const before = captureSnapshot();
    const targetGrid = synchronizedRoot(grid);
    targetGrid.derived = null;
    const characters = [...targetGrid.text];
    if (mode === "replace") characters[index] = letter;
    if (mode === "before") characters.splice(index, 0, letter);
    if (mode === "after") characters.splice(index + 1, 0, letter);
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

  function renameGrid(grid) {
    const before = captureSnapshot();
    const name = prompt("Grid name", grid.name);
    if (!name?.trim()) return;
    grid.name = name.trim();
    renderAll();
    commitHistory(before, "rename grid");
  }

  function saveSnapshot() {
    saveActiveWorkspaceState();
    const snapshot = captureSnapshot();
    localStorage.setItem("kryptos-sandbox-snapshot", JSON.stringify(snapshot));
    const library = { folders: state.folders, workspaces: state.workspaces, activeWorkspaceId: state.activeWorkspaceId, activeFolderId: state.activeFolderId };
    localStorage.setItem("kryptos-workspace-library", JSON.stringify(library));
    toast("Workspace snapshot saved locally");
    setStatus("All changes saved");
  }

  function loadSnapshot() {
    try {
      const raw = localStorage.getItem("kryptos-sandbox-snapshot");
      if (!raw) return false;
      const snapshot = JSON.parse(raw);
      state.grids = snapshot.grids.map(grid => ({ ...grid, selected: new Set(grid.selected || []) }));
      state.overlays = snapshot.overlays || [];
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
    $("#saveButton").addEventListener("click", saveSnapshot);

    $$(".tool-button[data-mode]").forEach(button => button.addEventListener("click", () => {
      state.tool = button.dataset.mode;
      $$(".tool-button[data-mode]").forEach(item => item.classList.toggle("active", item === button));
      workspace.classList.toggle("panning", state.tool === "pan");
      setStatus(`${button.textContent.trim()} tool active`);
    }));

    let panStart = null;
    workspace.addEventListener("pointerdown", event => {
      if (event.target.closest(".grid-card")) return;
      if (state.tool === "pan") {
        panStart = { x: event.clientX, y: event.clientY, left: workspace.scrollLeft, top: workspace.scrollTop };
        workspace.classList.add("active-pan");
        return;
      }
      if (event.button === 0 && (state.selectedGridId || state.grids.some(grid => grid.selected.size))) {
        const before = captureSnapshot();
        state.grids.forEach(grid => grid.selected.clear());
        state.selectedGridId = null;
        state.selectedGridIds = [];
        state.analysisFullGrid = true;
        renderAll();
        commitHistory(before, "deselect workspace");
        setStatus("Selection cleared");
      }
    });
    workspace.addEventListener("dblclick", event => {
      if (event.target.closest(".grid-card")) return;
      const bounds = workspace.getBoundingClientRect();
      const x = Math.max(0, Math.round(((event.clientX - bounds.left + workspace.scrollLeft) / state.zoom) / 8) * 8);
      const y = Math.max(0, Math.round(((event.clientY - bounds.top + workspace.scrollTop) / state.zoom) / 8) * 8);
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
            { icon: "✎", label: `Replace letter ${index + 1}…`, action: () => editLetterAt(grid, index, "replace") },
            { icon: "←", label: "Insert letter before…", action: () => editLetterAt(grid, index, "before") },
            { icon: "→", label: "Insert letter after…", action: () => editLetterAt(grid, index, "after") },
            { icon: "×", label: "Delete this letter", danger: true, action: () => editLetterAt(grid, index, "delete") },
            { separator: true },
          );
        }
        items.push(
          { icon: "⌘", label: "Copy grid", action: () => copyText(formatGridForClipboard(grid)) },
          { icon: "✎", label: "Rename grid…", action: () => renameGrid(grid) },
          { icon: "⧉", label: "Duplicate grid", action: duplicateGrid },
          { icon: "⇄", label: "Create synchronized view…", action: createSynchronizedView },
          { icon: "↷", label: "Rotate clockwise", action: () => transformGrid("right") },
          { icon: "⤢", label: "Transpose", action: () => transformGrid("transpose") },
          { separator: true },
          { icon: "⌫", label: "Delete grid", danger: true, action: deleteGrid },
        );
        showContextMenu(items, event.clientX, event.clientY);
        return;
      }
      const bounds = workspace.getBoundingClientRect();
      const x = Math.max(0, Math.round(((event.clientX - bounds.left + workspace.scrollLeft) / state.zoom) / 8) * 8);
      const y = Math.max(0, Math.round(((event.clientY - bounds.top + workspace.scrollTop) / state.zoom) / 8) * 8);
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
        { icon: "○", label: "Clear selection", action: () => {
          if (!state.selectedGridIds.length) return;
          const before = captureSnapshot();
          state.grids.forEach(grid => grid.selected.clear());
          state.selectedGridId = null;
          state.selectedGridIds = [];
          renderAll();
          commitHistory(before, "deselect workspace");
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
    $("#gridColumns").addEventListener("change", event => { const grid = currentGrid(); if (grid) { const before = captureSnapshot(); grid.derived = null; if (grid.text.includes(" ")) grid.text = grid.text.replaceAll(" ", ""); grid.cols = clamp(Number(event.target.value) || 1, 1, 500); fitGridCardToContent(grid); grid.selected.clear(); renderAll(); commitHistory(before, `reshape ${grid.name}`); } });
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
      state.overlays.forEach(overlay => { if (overlay.overlayId === grid?.id) overlay.operation = event.target.value; });
      renderAll();
      commitHistory(preferenceHistoryBefore, "change combine operation");
    });
    $("#runGridOperation").addEventListener("click", () => {
      const [baseId, overlayId] = state.selectedGridIds;
      const base = state.grids.find(grid => grid.id === baseId);
      const overlay = state.grids.find(grid => grid.id === overlayId);
      if (!base || !overlay) return toast("Select operand A, then operand B");
      const before = captureSnapshot();
      combineGrids(base, overlay);
      commitHistory(before, `${$("#combineOperation").value} ${base.name} and ${overlay.name}`);
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
      if (sequence.length >= 2) renderPeriodScan(sequence);
    });
    $("#periodScanList").addEventListener("click", event => {
      const row = event.target.closest("[data-period]");
      if (!row) return;
      analysisPeriod = Number(row.dataset.period);
      const sequence = selectedSequence().replace(/[^A-Z]/g, "");
      renderPeriodScan(sequence);
    });
    $("#candidateKey").addEventListener("input", () => renderVigenerePreview());
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

    $("#zoomIn").addEventListener("click", () => { const before = captureSnapshot(); state.zoom = clamp(state.zoom + .1, .6, 1.5); applyZoom(); commitHistory(before, "zoom in"); });
    $("#zoomOut").addEventListener("click", () => { const before = captureSnapshot(); state.zoom = clamp(state.zoom - .1, .6, 1.5); applyZoom(); commitHistory(before, "zoom out"); });
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
          { icon: "✎", label: "Rename workspace…", action: () => renameWorkspaceEntry(entry) },
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
          { icon: "＋", label: "New workspace here…", action: () => createWorkspace(folder.id) },
          { icon: "✎", label: "Rename folder…", action: () => { const name = prompt("Folder name", folder.name); if (name?.trim()) { folder.name = name.trim(); renderWorkspaceTree(); scheduleLibraryPersistence(); } } },
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
        { icon: "＋", label: "New workspace…", action: () => createWorkspace() },
        { icon: "▰", label: "New folder…", action: () => {
          const name = prompt("Folder name", "New folder");
          if (!name?.trim()) return;
          const folder = { id: uniqueId("folder"), name: name.trim(), open: true };
          state.folders.push(folder); state.activeFolderId = folder.id; renderWorkspaceTree(); scheduleLibraryPersistence();
        } },
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
      if (type === "k1") addGrid(K1_CIPHERTEXT, "K1 ciphertext", { cols: 21, width: 648, height: 205 });
      if (type === "k2") addGrid(K2_CIPHERTEXT, "K2 ciphertext", { cols: 31, width: 948, height: 415 });
      if (type === "k3") addGrid(K3_CIPHERTEXT, "K3 ciphertext", { cols: 21, width: 648, height: 535 });
      if (type === "k4") addGrid(K4_CIPHERTEXT, "K4 ciphertext", { cols: 14, width: 445, height: 280 });
      if (type === "random-english") {
        const sample = randomEnglishBookSample();
        addGrid(sample.text, `English · ${sample.title}`, { cols: 10, width: 330, height: 395 });
      }
      if (type === "alphabet") addGrid(KRYPTOS_ALPHABET, "Kryptos alphabet", { cols: 13, width: 415, height: 145 });
      if (type === "crib-east") addGrid("EASTNORTHEAST", "K4 crib · EASTNORTHEAST", { cols: 13, width: 420, height: 115 });
      if (type === "crib-berlin") addGrid("BERLINCLOCK", "K4 crib · BERLINCLOCK", { cols: 11, width: 355, height: 115 });
      if (type === "positional") addGrid(positionalK4Cribs(), "K4 positional crib mask", { cols: 14, width: 445, height: 280, preserveSparse: true });
    }));
    $("#renameWorkspace").addEventListener("click", () => { const entry = state.workspaces.find(item => item.id === state.activeWorkspaceId); if (entry) renameWorkspaceEntry(entry); });
    $("#addWorkspace").addEventListener("click", () => createWorkspace());

    document.addEventListener("pointerdown", event => {
      if (!event.target.closest(".clone-extend-control")) closeCloneExtend();
    });
    document.addEventListener("keydown", event => {
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if (command && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
      if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (!deleteSelectedLetters()) deleteGrid();
        return;
      }
      if (!command && !event.altKey && event.key.length === 1 && /^[A-Z?]$/i.test(event.key)) {
        if (typeIntoSelection(event.key)) {
          event.preventDefault();
          return;
        }
      }
      if (event.key.toLowerCase() === "v") $(".tool-button[data-mode='select']").click();
      if (event.key.toLowerCase() === "h") $(".tool-button[data-mode='pan']").click();
      if (event.key === "Escape") { closeCloneExtend(); const grid = currentGrid(); if (grid?.selected.size) { const before = captureSnapshot(); grid.selected.clear(); synchronizeSelection(grid); state.analysisFullGrid = true; renderAll(); commitHistory(before, "clear selection"); } $("#helpModal").classList.add("hidden"); $("#aboutModal").classList.add("hidden"); }
    });
    document.addEventListener("copy", event => {
      if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName) && document.activeElement.selectionStart !== document.activeElement.selectionEnd) return;
      const grid = currentGrid();
      if (!grid) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", formatGridForClipboard(grid));
      toast(grid.selected.size ? `Copied ${grid.selected.size} selected letters` : `Copied ${grid.cols} × ${Math.ceil(grid.text.length / grid.cols)} grid`);
    });
    document.addEventListener("paste", event => {
      if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
      event.preventDefault();
      pasteIntoGrid(event.clipboardData.getData("text/plain"));
    });
  }

  function enableLiveReload() {
    const developmentHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (!developmentHosts.has(location.hostname)) return;
    const sources = ["index.html", "styles.css", "app.js", "modules/cipher.js", "modules/analysis.js", "modules/transposition-analysis.js", "modules/utils.js", "modules/matrix.js", "modules/context-menu.js"];
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
            library: { folders: state.folders, workspaces: state.workspaces, activeWorkspaceId: state.activeWorkspaceId, activeFolderId: state.activeFolderId },
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
