export type EditorSaveState = "synced" | "unsynced" | "saving" | "failed" | "conflict";
export type DraftSnapshot = { title: string; markdown: string; summary: string };
export type SavePayload = DraftSnapshot & { revision: number; baseVersion: number };
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
  backup: (payload: SavePayload) => void | Promise<void>;
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
  let queued = false;
  let backupTimer: unknown;
  let idleTimer: unknown;
  let maxTimer: unknown;

  function setState(next: EditorSaveState) { if (state !== next) { state = next; options.onState(next); } }
  function clear(handle: unknown) { if (handle !== undefined) { timers.clearTimeout(handle); } }
  function cancelTimers() { clear(backupTimer); clear(idleTimer); clear(maxTimer); backupTimer = idleTimer = maxTimer = undefined; }

  async function runBackup() {
    const payload = { ...options.snapshot(), revision, baseVersion: version };
    try { await options.backup(payload); options.onBackup?.({ ok: true, at: now() }); }
    catch { options.onBackup?.({ ok: false, at: now() }); }
  }

  async function runSave(reason: "idle" | "max" | "manual"): Promise<void> {
    if (blocked) return;
    if (saving) { queued = true; return; }
    const target = revision;
    // 没有新的修改就不重复提交：重复提交会用同一标识携带新的基础版本，被服务端判为冲突。
    if (target === savedRevision) return;
    const payload = { ...options.snapshot(), revision: target, baseVersion: version };
    saving = true;
    setState("saving");
    let outcome: SaveOutcome;
    try { outcome = await options.save(payload); }
    catch { outcome = { ok: false, kind: "failure" }; }
    saving = false;
    if (outcome.ok) {
      version = outcome.version;
      savedRevision = target;
      // 迟到响应：期间又有新输入时不能标记为已同步。
      setState(target === revision ? "synced" : "unsynced");
      if (target === revision) cancelTimers();
    } else if (outcome.kind === "conflict") {
      blocked = true;
      cancelTimers();
      setState("conflict");
    } else {
      setState(target === revision ? "failed" : "unsynced");
    }
    if (queued) { queued = false; void runSave("manual"); }
  }

  return {
    input() {
      revision += 1;
      if (blocked) { setState("conflict"); return; }
      setState("unsynced");
      clear(backupTimer); backupTimer = timers.setTimeout(() => { backupTimer = undefined; void runBackup(); }, options.cadence.localBackupMs);
      clear(idleTimer); idleTimer = timers.setTimeout(() => { idleTimer = undefined; void runSave("idle"); }, options.cadence.idleSaveMs);
      if (maxTimer === undefined) maxTimer = timers.setTimeout(() => { maxTimer = undefined; void runSave("max"); }, options.cadence.maxSaveMs);
    },
    saveNow: () => runSave("manual"),
    /** 用户选择载入服务器版本：本地文本被替换，调度从该版本重新开始。 */
    adoptServer(nextVersion: number) { blocked = false; revision = 0; savedRevision = 0; version = nextVersion; cancelTimers(); setState("synced"); },
    state: () => state,
    version: () => version,
    revision: () => revision,
    blocked: () => blocked,
    destroy: cancelTimers,
  };
}

export type SaveScheduler = ReturnType<typeof createSaveScheduler>;
