export function storageSafeWorkspaceLibrary(library) {
  return {
    ...library,
    workspaces: (library.workspaces || []).map(workspace => ({
      ...workspace,
      history: [],
      future: [],
    })),
  };
}

export function writeWorkspaceLibrary({ local, session, key, recoveryKey, library }) {
  const serialized = JSON.stringify(storageSafeWorkspaceLibrary(library));
  try {
    local.setItem(key, serialized);
  } catch (localError) {
    try {
      session.setItem(recoveryKey, serialized);
      return { storage: "session", bytes: serialized.length, error: localError };
    } catch (sessionError) {
      return { storage: "failed", bytes: serialized.length, error: sessionError, localError };
    }
  }
  try { session.removeItem(recoveryKey); } catch {}
  return { storage: "local", bytes: serialized.length };
}

export function readWorkspaceLibrary({ local, session, key, recoveryKey }) {
  let recovery = null;
  try { recovery = session.getItem(recoveryKey); } catch {}
  if (recovery) return { raw: recovery, storage: "session" };
  let durable = null;
  try { durable = local.getItem(key); } catch {}
  return { raw: durable, storage: durable ? "local" : null };
}
