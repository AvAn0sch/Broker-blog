"use client";

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useImperativeHandle, useRef, type RefObject } from "react";

export type CodeEditorHandle = { insert: (text: string) => boolean; focus: () => void };

/** CodeMirror 6 Markdown 源码编辑；外部替换（恢复副本、载入服务器版本）时整体同步文档。 */
export function CodeEditor({ value, onChange, label, handleRef }: { value: string; onChange: (next: string) => void; label: string; handleRef?: RefObject<CodeEditorHandle | null> }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const listener = useRef(onChange);
  listener.current = onChange;
  const syncing = useRef(false);

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(), history(), highlightActiveLine(), EditorView.lineWrapping, markdown(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.updateListener.of((update) => { if (update.docChanged && !syncing.current) listener.current(update.state.doc.toString()); }),
        EditorView.contentAttributes.of({ "aria-label": label, role: "textbox", "aria-multiline": "true" }),
      ],
    });
    const instance = new EditorView({ state, parent: host.current });
    view.current = instance;
    return () => { instance.destroy(); view.current = null; };
    // 编辑器只创建一次；后续文本变化通过下面的 effect 同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current === value) return;
    // 程序化替换（恢复副本、载入服务器版本）不算用户输入，不触发保存调度。
    syncing.current = true;
    try { instance.dispatch({ changes: { from: 0, to: current.length, insert: value } }); }
    finally { syncing.current = false; }
  }, [value]);

  useImperativeHandle(handleRef, () => ({
    insert(text: string) {
      const instance = view.current;
      if (!instance) return false;
      const { from, to } = instance.state.selection.main;
      instance.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      instance.focus();
      return true;
    },
    focus() { view.current?.focus(); },
  }), []);

  return <div className="editor-source" data-testid="editor-source" ref={host} />;
}
