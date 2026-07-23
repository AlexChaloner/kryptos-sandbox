import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("only an intentional empty-canvas pointer clears cell selections", () => {
  const start = app.indexOf('workspace.addEventListener("pointerdown"');
  const end = app.indexOf('workspace.addEventListener("dblclick"', start);
  assert.ok(start >= 0 && end > start);
  const handler = app.slice(start, end);
  assert.match(handler, /event\.target\.closest\("\.grid-card"\)/);
  assert.match(handler, /pointerHitsWorkspaceScrollbar/);
  assert.match(handler, /state\.grids\.forEach\(grid => grid\.selected\.clear\(\)\)/);
  assert.match(handler, /clear canvas selection/);
});

test("live-overlay styling keeps selected cells visibly selected", () => {
  assert.match(styles, /\.letter-cell\.live-overlay\.selected\s*\{/);
});

test("global menus stay above isolated grid layers and preview A stays above B", () => {
  assert.match(styles, /\.workspace\s*\{[^}]*isolation:\s*isolate/s);
  const previewA = styles.match(/\.grid-card\.preview-a\s*\{[^}]*z-index:\s*(\d+)/s);
  const previewB = styles.match(/\.grid-card\.preview-b\s*\{[^}]*z-index:\s*(\d+)/s);
  assert.ok(previewA && previewB);
  assert.ok(Number(previewA[1]) > Number(previewB[1]));
  assert.match(styles, /\.context-menu\s*\{[^}]*position:\s*fixed/s);
});

test("compaction is exposed as a separate disabled-until-useful action", () => {
  assert.match(html, /id="compactGrid"[^>]*disabled>Compact selected grid<\/button>/);
  assert.match(app, /compactSelectedGrid/);
  assert.match(app, /materializedOverlayLayout\(resolved\.combined\)/);
});

test("analysis sidebar exposes physical-line diagnostics and shape-aware routes", () => {
  assert.match(html, /id="gridDiagnosticList"/);
  assert.match(html, /id="gridRouteResults"/);
  assert.match(html, /id="createGridRoute"/);
  assert.match(app, /scanGridDiagnostics\(layout\.text, layout\.cols\)/);
  assert.match(app, /scanGridRoutes\(layout\.text, layout\.cols\)/);
  assert.match(app, /grid\.selected = new Set\(candidate\.indices\)/);
});

test("approved canvas hotkeys are scoped and documented", () => {
  assert.match(app, /command && event\.key\.toLowerCase\(\) === "a"/);
  assert.match(app, /selectAllGridCells\(\)/);
  assert.match(app, /nudgeCurrentGrid\(event\.key, event\.shiftKey \? 5 : 1\)/);
  assert.match(app, /\(grid\.cellSize \+ 2\) \* state\.zoom \* multiplier/);
  assert.match(app, /if \(event\.key === "Escape"\)/);
  assert.match(app, /document\.activeElement\.matches\("input, textarea, select, button, a, \[contenteditable='true'\]"\)/);
  assert.match(html, /⌘\/Ctrl \+ A/);
  assert.match(html, /Shift \+ Arrow/);
});

test("quick imports include a fresh K4-length uniform random grid", () => {
  assert.match(html, /data-import="random-letters"/);
  assert.match(app, /randomLetters\(97\)/);
  assert.match(app, /Uniform random · 97 letters/);
});

test("whole-grid copy and paste uses structured bundles while cell copy stays textual", () => {
  assert.match(app, /const copyingWholeGrids = selectedGrids\.length > 1 \|\| !grid\.selected\.size/);
  assert.match(app, /createGridBundle\(state\.grids, selectedGrids\.map/);
  assert.match(app, /GRID_BUNDLE_MIME/);
  assert.match(app, /application\/x-kryptos-grid/);
  assert.match(app, /pasteGridBundle\(clipboardBundle\)/);
  assert.match(app, /copiedGridClipboard = null/);
  assert.match(html, /duplicate copied grids/);
});

test("canvas marquee supports arbitrary multi-grid selection without turning three grids into operands", () => {
  assert.match(styles, /\.selection-marquee/);
  assert.match(app, /hitIds = \$\$\("\.grid-card", workspace\)/);
  assert.match(app, /state\.selectedGridIds = \[\.\.\.new Set\(\[\.\.\.initialIds, \.\.\.hitIds\]\)\]/);
  assert.match(app, /if \(operands\.length > 2\) return null/);
  assert.doesNotMatch(app, /state\.selectedGridIds = state\.selectedGridIds[^;]*\.slice\(0, 2\)/);
});

test("wheel zoom is pointer anchored and difference views are non-destructive", () => {
  assert.match(app, /workspace\.addEventListener\("wheel"/);
  assert.match(app, /setWorkspaceZoom\(state\.zoom \+ \(event\.deltaY < 0 \? \.08 : -\.08\), event\)/);
  assert.match(app, /scaleCanvasPositions\(state\.grids, previousZoom, next, anchorPoint\)/);
  assert.match(app, /gridDifferenceLayout\(grid\.text, grid\.cols, differenceModes\(grid\), state\.alphabet\)/);
  assert.match(app, /grid\.differenceHorizontal = axis === "horizontal"/);
  assert.match(app, /grid\.differenceVertical = axis === "vertical"/);
  assert.match(app, /if \(!overlay \|\| !overlayCard \|\| hasDifferenceView\(overlay\)\) return/);
  assert.match(app, /grid\.cols \* 2 - 1/);
  assert.match(app, /sourceRows \* 2 - 1/);
  assert.match(html, /data-difference-axis="horizontal"/);
  assert.match(html, /data-difference-axis="vertical"/);
});

test("typing appends to a single focused grid and batches persistence", () => {
  assert.match(app, /function appendLetterToCurrentGrid\(letter\)/);
  assert.match(app, /targetGrid\.text \+= letter\.toUpperCase\(\)/);
  assert.match(app, /appendTypingTimer = setTimeout\(finishAppendTyping, 450\)/);
  assert.match(app, /body\.scrollTop = body\.scrollHeight/);
  assert.match(app, /removeLastLetterFromCurrentGrid/);
  assert.match(html, /Just type A–Z or \? to append/);
});

test("expanded letter palette is validated and styled", () => {
  for (const colour of ["violet", "rose", "cyan"]) {
    assert.match(html, new RegExp(`data-letter-colour="${colour}"`));
    assert.match(styles, new RegExp(`highlight-${colour}`));
  }
});

test("creating from a live overlay produces an independent snapshot", () => {
  assert.match(app, /derived: link \? null : \{ baseId:/);
  assert.match(app, /derived: grid\.derived\?\.alignment \? null :/);
  assert.match(app, /independent snapshot/);
});

test("analysis follows preview and persisted live-overlay results", () => {
  assert.match(html, /id="analysisContext"/);
  assert.match(app, /liveOverlayAnalysisPreview\?\.gridId === grid\.id/);
  assert.match(app, /item => item\.overlayId === grid\.id/);
  assert.match(app, /materializedOverlayLayout\(resolved\.combined\)/);
  assert.match(app, /orderedSelectionIndices\(grid, layout\.cols, layout\.text\.length\)\.map\(index => layout\.text\[index\]\)/);
  assert.match(app, /setLiveOverlayAnalysisPreview\(resolved, overlay\)/);
  assert.match(app, /LIVE OVERLAY · \$\{layout\.label\}/);
});

test("analysis exposes headline period IC, conditional English coding, and rare board-edge signals", () => {
  assert.match(html, /id="maxPeriodIc"/);
  assert.match(html, /id="compressionBpc"/);
  assert.match(html, /id="analysisSignal"/);
  assert.match(app, /candidate\.averageIc > best\.averageIc/);
  assert.match(app, /candidate\.significance\.pValue < best\.significance\.pValue/);
  assert.match(app, /pValue: Math\.min\(1, periodSummary\.rareCandidate\.significance\.pValue \* testedPeriods\)/);
  assert.match(app, /new Worker\("\.\/compression-worker\.js\?v=1"/);
  assert.match(styles, /\.grid-card\.analysis-event/);
  assert.match(styles, /prefers-reduced-motion/);
});

test("overall IC is two-sided while period scans remain upper-tailed", () => {
  assert.match(html, /Two-sided random likelihood/);
  assert.match(app, /icSignificance\.twoSidedPValue/);
  assert.match(app, /periodSummary\.rareCandidate\.significance\.pValue/);
});

test("workspace persistence flushes on tab lifecycle events and handles storage failure", () => {
  assert.match(app, /window\.addEventListener\("pagehide"/);
  assert.match(app, /document\.addEventListener\("visibilitychange"/);
  assert.match(app, /writeWorkspaceLibrary\(/);
  assert.match(app, /refresh-safe recovery copy/);
});
