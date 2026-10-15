export const EDITOR_SESSION_KEY = "bb-editor-session";
export const EDITOR_TEMP_KEY = "bb-editor-temp";
export const EDITOR_CHANNEL = "bb-editor-sessions";

/**
 * 刷新时沿用 sessionStorage 中的窗口标识；复制标签页会带走同一标识，
 * 因此收到占用应答时必须分配新标识，绝不覆盖另一窗口的副本。
 */
export function resolveSessionId(input: { stored: string | null; occupied: boolean; generate: () => string }) {
  if (input.stored && !input.occupied) return input.stored;
  return input.generate();
}

export function resolveTempDraftId(input: { stored: string | null; generate: () => string }) {
  return input.stored ?? input.generate();
}

export type SessionChannel = Pick<BroadcastChannel, "postMessage" | "addEventListener" | "removeEventListener" | "close">;
export type EditorSession = { id: string; release(): void };

/** The owner answers probes for the entire editing lifetime, including tabs copied much later. */
export async function claimEditorSession(options: {
  storage?: Pick<Storage, "getItem" | "setItem">;
  channelFactory?: ((name: string) => SessionChannel) | null;
  generate?: () => string;
  wait?: () => Promise<unknown>;
  signal?: AbortSignal;
} = {}): Promise<EditorSession> {
  const generate = options.generate ?? (() => crypto.randomUUID());
  const storage = options.storage ?? window.sessionStorage;
  const factory = options.channelFactory === undefined ? (typeof BroadcastChannel === "undefined" ? null : (name: string) => new BroadcastChannel(name)) : options.channelFactory;
  options.signal?.throwIfAborted();
  if (!factory) {
    // Without a coordination channel prefer a new key; old copies remain discoverable by draft.
    const id = generate(); storage.setItem(EDITOR_SESSION_KEY, id);
    return { id, release() {} };
  }
  const channel = factory(EDITOR_CHANNEL);
  const claimId = generate();
  let id = storage.getItem(EDITOR_SESSION_KEY) ?? generate();
  let occupied = false, settled = false, closed = false;
  const listener = (event: MessageEvent) => {
    const data = event.data as { type?: string; sessionId?: string; claimId?: string; target?: string } | null;
    if (!data || data.sessionId !== id || typeof data.claimId !== "string" || data.claimId === claimId) return;
    if (data.type === "probe") {
      // Simultaneous claims use a deterministic winner; an established owner always keeps its key.
      if (settled || claimId < data.claimId) channel.postMessage({ type: "occupied", sessionId: id, claimId, target: data.claimId });
      else occupied = true;
    } else if (data.type === "occupied" && data.target === claimId) occupied = true;
  };
  const release = () => {
    if (closed) return;
    closed = true; channel.removeEventListener("message", listener); channel.close();
    options.signal?.removeEventListener("abort", release);
  };
  channel.addEventListener("message", listener);
  options.signal?.addEventListener("abort", release, { once: true });
  try {
    channel.postMessage({ type: "probe", sessionId: id, claimId });
    await (options.wait?.() ?? new Promise((resolve) => setTimeout(resolve, 150)));
    options.signal?.throwIfAborted();
    if (occupied) id = generate();
    settled = true;
    storage.setItem(EDITOR_SESSION_KEY, id);
    return { id, release };
  } catch (error) { release(); throw error; }
}

/** 临时草稿在同一窗口的刷新中保持稳定；新窗口（无 sessionStorage 值）得到新的临时标识。 */
export function tempDraftId(): string {
  const resolved = resolveTempDraftId({ stored: window.sessionStorage.getItem(EDITOR_TEMP_KEY), generate: () => `temp-${crypto.randomUUID()}` });
  window.sessionStorage.setItem(EDITOR_TEMP_KEY, resolved);
  return resolved;
}
