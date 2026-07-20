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

test("whole-grid copy and paste uses structured duplication while cell copy stays textual", () => {
  assert.match(app, /!grid\.selected\.size && state\.selectedGridIds\.length === 1/);
  assert.match(app, /application\/x-kryptos-grid/);
  assert.match(app, /duplicateGrid\(clipboardGrid\)/);
  assert.match(app, /copiedGridClipboard = null/);
  assert.match(html, /duplicate a copied whole grid/);
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
