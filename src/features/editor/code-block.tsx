"use client";

import { useRef, useState } from "react";

export function CodeBlock({ children }: { children?: React.ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const [message, setMessage] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(pre.current?.textContent ?? ""); setMessage("已复制"); }
    catch { setMessage("复制失败，请选中文字复制"); }
  }
  return <div className="code-block"><button type="button" className="quiet" onClick={() => void copy()}>复制代码</button><span className="editor-note" role="status">{message}</span><pre ref={pre}>{children}</pre></div>;
}
