import assert from "node:assert/strict";
import test from "node:test";

import { readWorkspaceLibrary, storageSafeWorkspaceLibrary, writeWorkspaceLibrary } from "../modules/persistence.js";

class MemoryStorage {
  constructor(fails = false) {
    this.fails = fails;
    this.values = new Map();
  }

  getItem(key) {
    if (this.fails) throw new DOMException("Storage unavailable", "SecurityError");
    return this.values.get(key) ?? null;
  }
  removeItem(key) {
    if (this.fails) throw new DOMException("Storage unavailable", "SecurityError");
    this.values.delete(key);
  }
  setItem(key, value) {
    if (this.fails) throw new DOMException("Quota exceeded", "QuotaExceededError");
    this.values.set(key, String(value));
  }
}

function library() {
  const snapshot = { grids: [{ id: "grid", text: "A".repeat(1000) }], overlays: [] };
  return {
    folders: [{ id: "folder", name: "Experiments" }],
    workspaces: [{ id: "workspace", folderId: "folder", document: snapshot, history: Array(100).fill({ snapshot }), future: [{ snapshot }] }],
    activeWorkspaceId: "workspace",
  };
}

test("durable workspace payload keeps documents but removes quota-heavy undo snapshots", () => {
  const original = library();
  const safe = storageSafeWorkspaceLibrary(original);
  assert.deepEqual(safe.workspaces[0].document, original.workspaces[0].document);
  assert.deepEqual(safe.workspaces[0].history, []);
  assert.deepEqual(safe.workspaces[0].future, []);
  assert.ok(JSON.stringify(safe).length < JSON.stringify(original).length / 20);
});

test("successful durable saves remove an obsolete session recovery", () => {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  session.setItem("recovery", "old");
  const result = writeWorkspaceLibrary({ local, session, key: "library", recoveryKey: "recovery", library: library() });
  assert.equal(result.storage, "local");
  assert.ok(local.getItem("library"));
  assert.equal(session.getItem("recovery"), null);
});

test("a successful local save remains successful when session storage is unavailable", () => {
  const local = new MemoryStorage();
  const result = writeWorkspaceLibrary({
    local, session: new MemoryStorage(true), key: "library", recoveryKey: "recovery", library: library(),
  });
  assert.equal(result.storage, "local");
  assert.ok(local.getItem("library"));
});

test("a saved workspace document survives the same write/read/parse round trip used on refresh", () => {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  const original = library();
  writeWorkspaceLibrary({ local, session, key: "library", recoveryKey: "recovery", library: original });
  const saved = readWorkspaceLibrary({ local, session, key: "library", recoveryKey: "recovery" });
  const restored = JSON.parse(saved.raw);
  assert.deepEqual(restored.workspaces[0].document, original.workspaces[0].document);
  assert.equal(restored.activeWorkspaceId, original.activeWorkspaceId);
});

test("quota failure writes and preferentially reads a refresh-safe session recovery", () => {
  const local = new MemoryStorage(true);
  const session = new MemoryStorage();
  const result = writeWorkspaceLibrary({ local, session, key: "library", recoveryKey: "recovery", library: library() });
  assert.equal(result.storage, "session");
  assert.ok(session.getItem("recovery"));
  assert.equal(readWorkspaceLibrary({ local: new MemoryStorage(), session, key: "library", recoveryKey: "recovery" }).storage, "session");
});

test("complete storage failure is reported instead of throwing out of the save timer", () => {
  const result = writeWorkspaceLibrary({
    local: new MemoryStorage(true), session: new MemoryStorage(true), key: "library", recoveryKey: "recovery", library: library(),
  });
  assert.equal(result.storage, "failed");
});
