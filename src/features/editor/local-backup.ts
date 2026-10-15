export type BackupRecord = {
  id: string; userId: string; draftId: string; sessionId: string;
  title: string; markdown: string; summary: string;
  tagIds?: string[];
  baseVersion: number; unsynced: boolean; savedAt: number; origin: string;
};

export const BACKUP_DATABASE = "broker-blog-editor";
export const BACKUP_STORE = "copies";

/** 副本按账号、文章（或临时草稿）与编辑窗口隔离，任何窗口只写自己的键。 */
export function backupId(userId: string, draftId: string, sessionId: string) { return `${userId}|${draftId}|${sessionId}`; }

export function isBackupRecord(value: unknown): value is BackupRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<BackupRecord>;
  return typeof record.id === "string" && typeof record.userId === "string" && typeof record.draftId === "string" && typeof record.sessionId === "string"
    && typeof record.title === "string" && typeof record.markdown === "string" && typeof record.summary === "string"
    && typeof record.baseVersion === "number" && typeof record.unsynced === "boolean" && typeof record.savedAt === "number";
}

/** 本地存储不可用时明确失败，绝不把“写不进去”当作已备份。 */
export function createBackupStore(options: { factory?: IDBFactory; database?: string } = {}) {
  const factory = options.factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  const database = options.database ?? BACKUP_DATABASE;
  let handle: Promise<IDBDatabase> | null = null;

  function open() {
    if (!factory) return Promise.reject(new Error("本机浏览器不支持本地备份存储。"));
    handle ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(database, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(BACKUP_STORE, { keyPath: "id" });
        store.createIndex("byUser", "userId");
        store.createIndex("byDraft", ["userId", "draftId"]);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("本地备份存储不可用。"));
    });
    return handle;
  }

  async function transact<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(BACKUP_STORE, mode);
      const request = work(transaction.objectStore(BACKUP_STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? new Error("本地备份事务未完成。"));
      transaction.onerror = () => reject(transaction.error ?? new Error("本地备份操作失败。"));
      request.onerror = () => reject(request.error ?? new Error("本地备份操作失败。"));
    });
  }

  return {
    async put(record: BackupRecord) { await transact("readwrite", (store) => store.put(record)); },
    async read(id: string) { const value = await transact<unknown>("readonly", (store) => store.get(id)); return isBackupRecord(value) ? value : null; },
    async listForDraft(userId: string, draftId: string) {
      const values = await transact<unknown[]>("readonly", (store) => store.index("byDraft").getAll([userId, draftId]));
      return values.filter(isBackupRecord).sort((a, b) => b.savedAt - a.savedAt);
    },
    async remove(id: string) { await transact("readwrite", (store) => store.delete(id)); },
    async move(from: string, to: string, draftId: string) {
      if (from === to) return;
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(BACKUP_STORE, "readwrite");
        const store = transaction.objectStore(BACKUP_STORE);
        const source = store.get(from), destination = store.get(to);
        destination.onsuccess = () => {
          if (isBackupRecord(source.result)) {
            if (!isBackupRecord(destination.result) || destination.result.savedAt < source.result.savedAt) store.put({ ...source.result, id: to, draftId });
            store.delete(from);
          }
        };
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error("本地副本迁移失败。"));
      });
    },
    async clearUser(userId: string) {
      const ids = (await transact<IDBValidKey[]>("readonly", (store) => store.index("byUser").getAllKeys(userId)));
      for (const id of ids) await transact("readwrite", (store) => store.delete(id));
      return ids.length;
    },
  };
}

export type BackupStore = ReturnType<typeof createBackupStore>;
