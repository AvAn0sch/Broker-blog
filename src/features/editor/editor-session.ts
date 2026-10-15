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

export async function editorSessionId(): Promise<string> {
  const generate = () => crypto.randomUUID();
  const stored = window.sessionStorage.getItem(EDITOR_SESSION_KEY);
  if (typeof BroadcastChannel === "undefined") {
    const resolved = resolveSessionId({ stored, occupied: false, generate });
    window.sessionStorage.setItem(EDITOR_SESSION_KEY, resolved);
    return resolved;
  }
  const channel = new BroadcastChannel(EDITOR_CHANNEL);
  const proposed = stored ?? generate();
  let occupied = false;
  const listener = (event: MessageEvent) => {
    const data = event.data as { type?: string; sessionId?: string } | null;
    if (data?.type === "probe" && data.sessionId === proposed) { occupied = true; channel.postMessage({ type: "occupied", sessionId: proposed }); }
  };
  channel.addEventListener("message", listener);
  channel.postMessage({ type: "probe", sessionId: proposed });
  await new Promise((resolve) => setTimeout(resolve, 150));
  channel.removeEventListener("message", listener);
  channel.close();
  const resolved = resolveSessionId({ stored: proposed, occupied, generate });
  window.sessionStorage.setItem(EDITOR_SESSION_KEY, resolved);
  return resolved;
}

/** 临时草稿在同一窗口的刷新中保持稳定；新窗口（无 sessionStorage 值）得到新的临时标识。 */
export function tempDraftId(): string {
  const resolved = resolveTempDraftId({ stored: window.sessionStorage.getItem(EDITOR_TEMP_KEY), generate: () => `temp-${crypto.randomUUID()}` });
  window.sessionStorage.setItem(EDITOR_TEMP_KEY, resolved);
  return resolved;
}
