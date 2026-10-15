export type EditorSaveState = "synced" | "unsynced" | "saving" | "failed" | "conflict";
export type DraftSnapshot = { title: string; markdown: string; summary: string; tagIds?: string[] };
export type SavePayload = DraftSnapshot & { revision: number; baseVersion: number };
export type BackupPayload = SavePayload & { unsynced: boolean };
export type SaveOutcome = { ok: true; version: number } | { ok: false; kind: "conflict" | "failure" };
export type SchedulerTimers = { setTimeout: (handler: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void };

export type SaveCadence = { localBackupMs: number; idleSaveMs: number; maxSaveMs: number };

const defaultTimers: SchedulerTimers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

/**
 * 保存调度：输入后最长 1 秒写本地副本，停止输入 3 秒保存，持续输入最长 30 秒保存一次。
 * 迟到的响应不会把更新的文本标记为已同步；版本冲突立即暂停自动提交，等待用户选择。
 */
export function createSaveScheduler(options: {
  initialVersion: number;
  cadence: SaveCadence;
  snapshot: () => DraftSnapshot;
  backup: (payload: BackupPayload) => void | Promise<void>;
  save: (payload: SavePayload) => Promise<SaveOutcome>;
  onState: (state: EditorSaveState) => void;
  onBackup?: (result: { ok: boolean; at: number }) => void;
  timers?: SchedulerTimers;
  now?: () => number;
}) {
  const timers = options.timers ?? defaultTimers;
  const now = options.now ?? (() => Date.now());
  let state: EditorSaveState = "synced";
  let revision = 0;
  let savedRevision = 0;
  let version = options.initialVersion;
  let blocked = false;
  let saving = false;
  let activeSave: Promise<void> = Promise.resolve();
  let queued = false;
  let destroyed = false;
  let generation = 0;
  let backupQueue = Promise.resolve(true);
  let backupTimer: unknown;
  let idleTimer: unknown;
  let maxTimer: unknown;

  function setState(next: EditorSaveState) { if (state !== next) { state = next; options.onState(next); } }
  function clear(handle: unknown) { if (handle !== undefined) { timers.clearTimeout(handle); } }
  function cancelSaveTimers() { clear(idleTimer); clear(maxTimer); idleTimer = maxTimer = undefined; }
  function cancelTimers() { clear(backupTimer); backupTimer = undefined; cancelSaveTimers(); }

  function runBackup() {
    // Serial writes take the latest snapshot when executed, so a slow older write cannot win.
    backupQueue = backupQueue.then(async () => {
      if (destroyed) return false;
      const payload = { ...options.snapshot(), revision, baseVersion: version, unsynced: revision !== savedRevision };
      try { await options.backup(payload); if (!destroyed) options.onBackup?.({ ok: true, at: now() }); return true; }
      catch { if (!destroyed) options.onBackup?.({ ok: false, at: now() }); return false; }
    });
    return backupQueue;
  }

  function runSave(reason: "idle" | "max" | "manual"): Promise<void> {
    if (saving) { queued = true; return activeSave; }
    activeSave = performSave(reason);
    return activeSave;
  }

  async function performSave(reason: "idle" | "max" | "manual"): Promise<void> {
    if (blocked || destroyed) return;
    if (saving) { queued = true; return; }
    const target = revision;
    const startedGeneration = generation;
    // 没有新的修改就不重复提交：重复提交会用同一标识携带新的基础版本，被服务端判为冲突。
    if (target === savedRevision) return;
    const payload = { ...options.snapshot(), revision: target, baseVersion: version };
    saving = true;
    setState("saving");
    let outcome: SaveOutcome;
    try { outcome = await options.save(payload); }
    catch { outcome = { ok: false, kind: "failure" }; }
    saving = false;
    if (destroyed || startedGeneration !== generation) return;
    if (outcome.ok) {
      version = outcome.version;
      savedRevision = target;
      // 迟到响应：期间又有新输入时不能标记为已同步。
      setState(target === revision ? "synced" : "unsynced");
      if (target === revision) cancelSaveTimers();
      void runBackup();
    } else if (outcome.kind === "conflict") {
      blocked = true;
      cancelSaveTimers();
      setState("conflict");
    } else {
      setState(target === revision ? "failed" : "unsynced");
    }
    if (queued) { queued = false; void runSave("manual"); }
  }

  return {
    input() {
      if (destroyed) return;
      revision += 1;
      // Local recovery keeps running when server submission is blocked by a conflict.
      if (backupTimer === undefined) backupTimer = timers.setTimeout(() => { backupTimer = undefined; void runBackup(); }, options.cadence.localBackupMs);
      if (blocked) { setState("conflict"); return; }
      setState("unsynced");
      clear(idleTimer); idleTimer = timers.setTimeout(() => { idleTimer = undefined; void runSave("idle"); }, options.cadence.idleSaveMs);
      if (maxTimer === undefined) maxTimer = timers.setTimeout(() => { maxTimer = undefined; void runSave("max"); }, options.cadence.maxSaveMs);
    },
    saveNow: () => runSave("manual"),
    async flush() {
      // An in-flight request may only confirm an older revision. Await subsequent writes too.
      for (let attempt = 0; attempt < 5; attempt++) {
        await runSave("manual");
        if (destroyed || blocked || state === "failed") return null;
        if (state === "synced" && savedRevision === revision) return { version, revision };
      }
      return null;
    },
    backupNow: runBackup,
    /** 用户选择载入服务器版本：本地文本被替换，调度从该版本重新开始。 */
    adoptServer(nextVersion: number) {
      generation += 1; blocked = false; queued = false;
      // Keep revision monotonic so a new editing cycle never reuses an old submission key.
      savedRevision = revision; version = nextVersion; cancelTimers(); setState("synced");
    },
    state: () => state,
    version: () => version,
    revision: () => revision,
    blocked: () => blocked,
    destroy() { destroyed = true; cancelTimers(); },
  };
}

export type SaveScheduler = ReturnType<typeof createSaveScheduler>;
