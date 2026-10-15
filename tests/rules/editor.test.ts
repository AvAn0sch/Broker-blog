import { describe, expect, it } from "vitest";
import { backupId, isBackupRecord } from "../../src/features/editor/local-backup";
import { claimEditorSession, EDITOR_SESSION_KEY, resolveSessionId, resolveTempDraftId } from "../../src/features/editor/editor-session";
import { safeUrl } from "../../src/features/editor/markdown-url";
import { createSaveScheduler, type BackupPayload, type SavePayload, type SaveOutcome, type SchedulerTimers } from "../../src/features/editor/save-scheduler";
import { contentPolicy, extractMediaIds } from "../../src/modules/content/policy";

/** 受控时钟：按时间顺序触发到期定时器，并在每次触发后让异步处理器结算。 */
function fakeClock() {
  let now = 0; let nextId = 1;
  const pending = new Map<number, { at: number; handler: () => void }>();
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const timers: SchedulerTimers = {
    setTimeout(handler, ms) { const id = nextId++; pending.set(id, { at: now + ms, handler }); return id; },
    clearTimeout(handle) { pending.delete(handle as number); },
  };
  return {
    timers, now: () => now, flush,
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].handler();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

function schedulerFor(options: { save: (payload: SavePayload) => Promise<SaveOutcome>; backup?: (payload: BackupPayload) => void | Promise<void>; initialVersion?: number }) {
  const clock = fakeClock();
  const events: string[] = [];
  const backups: { ok: boolean; at: number }[] = [];
  const scheduler = createSaveScheduler({
    initialVersion: options.initialVersion ?? 1,
    cadence: contentPolicy.autosave,
    snapshot: () => ({ title: "标题", markdown: "正文", summary: "" }),
    backup: options.backup ?? (() => { events.push("backup"); }),
    save: async (payload) => { events.push("save"); return options.save(payload); },
    onState: (state) => events.push(`state:${state}`),
    onBackup: (result) => backups.push(result),
    timers: clock.timers,
    now: clock.now,
  });
  return { scheduler, clock, events, backups };
}

describe("B2 save scheduling", () => {
  it("backs up locally within one second and saves after three idle seconds", async () => {
    const { scheduler, clock, events } = schedulerFor({ save: async () => ({ ok: true, version: 2 }) });
    scheduler.input();
    expect(scheduler.state()).toBe("unsynced");
    await clock.advance(contentPolicy.autosave.localBackupMs - 1);
    expect(events).not.toContain("backup");
    await clock.advance(1);
    expect(events).toContain("backup");
    await clock.advance(contentPolicy.autosave.idleSaveMs - contentPolicy.autosave.localBackupMs - 1);
    expect(events).not.toContain("save");
    await clock.advance(1);
    expect(events).toContain("save");
    expect(scheduler.state()).toBe("synced");
    expect(scheduler.version()).toBe(2);
  });

  it("saves at least once every thirty seconds while typing continues", async () => {
    const { scheduler, clock, events } = schedulerFor({ save: async () => ({ ok: true, version: 2 }) });
    for (let second = 0; second < 35; second++) { scheduler.input(); await clock.advance(1_000); }
    expect(events.filter((event) => event === "save")).toHaveLength(1);
  });

  it("backs up every second during uninterrupted input rather than waiting for a pause", async () => {
    const { scheduler, clock, backups, events } = schedulerFor({ save: async () => ({ ok: true, version: 2 }) });
    for (let tick = 0; tick < 40; tick++) { scheduler.input(); await clock.advance(250); }
    expect(backups.map((backup) => backup.at)).toEqual(Array.from({ length: 10 }, (_, index) => (index + 1) * 1000));
    expect(events).not.toContain("save");
    scheduler.destroy();
  });

  it("continues local backup for new conflict text while server writes stay paused", async () => {
    const copies: BackupPayload[] = [];
    const { scheduler, clock, events } = schedulerFor({ save: async () => ({ ok: false, kind: "conflict" }), backup: (payload) => { copies.push(payload); } });
    scheduler.input(); await clock.advance(3000);
    expect(scheduler.state()).toBe("conflict");
    const firstRevision = copies.at(-1)!.revision;
    scheduler.input(); await clock.advance(1000);
    expect(copies.at(-1)).toMatchObject({ revision: firstRevision + 1, unsynced: true });
    await clock.advance(30000);
    expect(events.filter((event) => event === "save")).toHaveLength(1);
    scheduler.destroy();
  });

  it("keeps revisions unique when editing resumes after loading a server version", async () => {
    const writes: SavePayload[] = [];
    const { scheduler, clock } = schedulerFor({ save: async (payload) => {
      writes.push(payload);
      return writes.length === 2 ? { ok: false, kind: "conflict" } : { ok: true, version: payload.baseVersion + 1 };
    } });
    scheduler.input(); await scheduler.saveNow();
    scheduler.input(); await scheduler.saveNow();
    expect(scheduler.state()).toBe("conflict");
    scheduler.adoptServer(7);
    scheduler.input(); await scheduler.saveNow(); await clock.flush();
    expect(writes.map((write) => write.revision)).toEqual([1, 2, 3]);
    expect(writes.at(-1)?.baseVersion).toBe(7);
    expect(scheduler.state()).toBe("synced");
    scheduler.destroy();
  });

  it("stores the confirmed sync state even when manual save finishes before the backup timer", async () => {
    const copies: BackupPayload[] = [];
    const { scheduler, clock } = schedulerFor({ save: async () => ({ ok: true, version: 2 }), backup: (payload) => { copies.push(payload); } });
    scheduler.input(); await scheduler.saveNow(); await clock.advance(1000);
    expect(copies.at(-1)).toMatchObject({ unsynced: false, baseVersion: 2 });
    scheduler.destroy();
  });

  it("does not update a destroyed editor when its save response arrives late", async () => {
    let complete!: (result: SaveOutcome) => void;
    const { scheduler, events, clock } = schedulerFor({ save: () => new Promise((resolve) => { complete = resolve; }) });
    scheduler.input(); const saved = scheduler.saveNow();
    scheduler.destroy(); complete({ ok: true, version: 2 }); await saved; await clock.advance(30000);
    expect(events).not.toContain("state:synced");
    expect(events).not.toContain("backup");
  });

  it("never reports synced for text that changed while a save was in flight", async () => {
    let release: (() => void) | null = null;
    const { scheduler, clock } = schedulerFor({ save: () => new Promise<SaveOutcome>((resolve) => { release = () => resolve({ ok: true, version: 5 }); }) });
    scheduler.input();
    await clock.advance(contentPolicy.autosave.idleSaveMs);
    expect(scheduler.state()).toBe("saving");
    scheduler.input();
    release!();
    await clock.flush();
    expect(scheduler.state()).toBe("unsynced");
    expect(scheduler.version()).toBe(5);
  });

  it("pauses automatic saves on a version conflict until the local state is re-based", async () => {
    let saves = 0;
    const { scheduler, clock } = schedulerFor({ save: async () => { saves += 1; return { ok: false, kind: "conflict" }; } });
    scheduler.input();
    await clock.advance(contentPolicy.autosave.idleSaveMs);
    expect(scheduler.state()).toBe("conflict");
    expect(scheduler.blocked()).toBe(true);
    scheduler.input();
    await clock.advance(contentPolicy.autosave.maxSaveMs);
    expect(saves).toBe(1);
    scheduler.adoptServer(7);
    expect(scheduler.state()).toBe("synced");
    expect(scheduler.version()).toBe(7);
    scheduler.input();
    await clock.advance(contentPolicy.autosave.idleSaveMs);
    expect(saves).toBe(2);
  });

  it("reports failure instead of sync when the server call fails", async () => {
    const { scheduler, clock } = schedulerFor({ save: async () => ({ ok: false, kind: "failure" }) });
    scheduler.input();
    await clock.advance(contentPolicy.autosave.idleSaveMs);
    expect(scheduler.state()).toBe("failed");
  });

  it("reports a failed local backup instead of claiming one", async () => {
    const { scheduler, clock, backups } = schedulerFor({ save: async () => ({ ok: true, version: 2 }), backup: () => { throw new Error("quota exceeded"); } });
    scheduler.input();
    await clock.advance(contentPolicy.autosave.localBackupMs);
    expect(backups).toEqual([{ ok: false, at: contentPolicy.autosave.localBackupMs }]);
  });
});

describe("B2 editor helpers", () => {
  it("keeps a live owner listening when a tab is copied later and releases ownership on exit", async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const first = await claimEditorSession({ storage });
    let duplicate: Awaited<ReturnType<typeof claimEditorSession>> | undefined;
    try {
      const clonedValues = new Map(values);
      const clonedStorage = { getItem: (key: string) => clonedValues.get(key) ?? null, setItem: (key: string, value: string) => { clonedValues.set(key, value); } };
      duplicate = await claimEditorSession({ storage: clonedStorage });
      expect(duplicate.id).not.toBe(first.id);
      expect(values.get(EDITOR_SESSION_KEY)).toBe(first.id);
      first.release();
      const refreshed = await claimEditorSession({ storage });
      try { expect(refreshed.id).toBe(first.id); } finally { refreshed.release(); }
    } finally { first.release(); duplicate?.release(); }
  });

  it("resolves simultaneous claims for a cloned session without sharing the backup key", async () => {
    const makeStorage = () => {
      const values = new Map([[EDITOR_SESSION_KEY, "cloned-editor"]]);
      return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    };
    const claims = await Promise.all([claimEditorSession({ storage: makeStorage() }), claimEditorSession({ storage: makeStorage() })]);
    try { expect(new Set(claims.map((claim) => claim.id)).size).toBe(2); }
    finally { claims.forEach((claim) => claim.release()); }
  });
  it("keeps editor sessions separate and re-keys a duplicated tab", () => {
    const generate = () => "new-session";
    expect(resolveSessionId({ stored: "tab-a", occupied: false, generate })).toBe("tab-a");
    expect(resolveSessionId({ stored: "tab-a", occupied: true, generate })).toBe("new-session");
    expect(resolveSessionId({ stored: null, occupied: false, generate })).toBe("new-session");
    expect(resolveTempDraftId({ stored: "temp-1", generate })).toBe("temp-1");
    expect(resolveTempDraftId({ stored: null, generate: () => "temp-2" })).toBe("temp-2");
  });

  it("isolates local copies by account, draft and editor window", () => {
    expect(backupId("user-1", "article-1", "session-1")).toBe("user-1|article-1|session-1");
    const record = { id: "a|b|c", userId: "a", draftId: "b", sessionId: "c", title: "t", markdown: "m", summary: "", baseVersion: 1, unsynced: true, savedAt: 1, origin: "/editor/new" };
    expect(isBackupRecord(record)).toBe(true);
    expect(isBackupRecord({ ...record, markdown: 5 })).toBe(false);
    expect(isBackupRecord(null)).toBe(false);
  });

  it("allows only approved link protocols", () => {
    expect(safeUrl("https://example.test/a")).toBe("https://example.test/a");
    expect(safeUrl("http://example.test/a")).toBe("http://example.test/a");
    expect(safeUrl("mailto:someone@example.test")).toBe("mailto:someone@example.test");
    expect(safeUrl("/api/v1/media/abc")).toBe("/api/v1/media/abc");
    expect(safeUrl("#section")).toBe("#section");
    for (const blocked of ["javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "vbscript:msgbox", "file:///etc/passwd", "  javascript:alert(1)  "]) {
      expect(safeUrl(blocked)).toBe("");
    }
    expect(safeUrl(undefined)).toBe("");
  });

  it("extracts unique controlled media references from draft text", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";
    const markdown = `![图](/api/v1/media/${id})\n\n再次引用 /api/v1/media/${id}，外部图片 https://evil.test/x.png，另一张 /api/v1/media/${other}`;
    expect(extractMediaIds(markdown).sort()).toEqual([id, other]);
    expect(extractMediaIds("没有引用")).toEqual([]);
  });
});
