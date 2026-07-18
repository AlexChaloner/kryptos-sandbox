import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("canvas focus and scrollbar handling never clear cell selections", () => {
  const start = app.indexOf('workspace.addEventListener("pointerdown"');
  const end = app.indexOf('workspace.addEventListener("dblclick"', start);
  assert.ok(start >= 0 && end > start);
  const handler = app.slice(start, end);
  assert.doesNotMatch(handler, /selected\.clear\(/);
  assert.match(handler, /pointerHitsWorkspaceScrollbar/);
  assert.match(handler, /cell selections preserved/);
});

test("live-overlay styling keeps selected cells visibly selected", () => {
  assert.match(styles, /\.letter-cell\.live-overlay\.selected\s*\{/);
});

test("compaction is exposed as a separate disabled-until-useful action", () => {
  assert.match(html, /id="compactGrid"[^>]*disabled>Compact selected grid<\/button>/);
  assert.match(app, /compactSelectedGrid/);
  assert.match(app, /materializedOverlayLayout\(resolved\.combined\)/);
});
