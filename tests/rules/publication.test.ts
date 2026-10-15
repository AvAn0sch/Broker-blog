import { describe, expect, it } from "vitest";
import { publicationMarkdown, suggestedSummary } from "../../src/modules/content/markdown";
import { draftContentSchema } from "../../src/modules/content/policy";
import { createSaveScheduler } from "../../src/features/editor/save-scheduler";

describe("B3 publication policy", () => {
  it("counts Unicode code points consistently at every content boundary", () => {
    expect(draftContentSchema.safeParse({ title: "😀".repeat(100), markdown: "文".repeat(100000), summary: "😀".repeat(200) }).success).toBe(true);
    for (const patch of [{ title: "😀".repeat(101) }, { markdown: "😀".repeat(100001) }, { summary: "😀".repeat(201) }]) expect(draftContentSchema.safeParse({ title: "标题", markdown: "正文", summary: "", ...patch }).success).toBe(false);
  });
  it("validates actual inline and reference images but leaves examples inside code alone", () => {
    const id = "e9fbe49a-ea65-4488-9659-e637e053a17a";
    const valid = publicationMarkdown(`![inline](/api/v1/media/${id})\n\n![ref][pic]\n\n[pic]: /api/v1/media/${id}\n\n\`![code](https://evil.test/x)\`\n\n\`\`\`md\n![code](data:image/png;base64,AAAA)\n\`\`\``);
    expect(valid.invalidImage).toBe(false); expect(valid.mediaIds).toEqual([id]);
    for (const url of ["https://evil.test/image.png", "//evil.test/x", "data:image/png;base64,AAAA", "blob:thing", `/api/v1/media/${id}?x=1`, "/api/v1/media/missing"]) expect(publicationMarkdown(`![image](${url})`).invalidImage).toBe(true);
    expect(publicationMarkdown("![image][pic]\n\n[pic]: https://evil.test/x").invalidImage).toBe(true);
  });
  it("creates plain editable summaries and stable distinct heading anchors without raw HTML", () => {
    const markdown = "## 相同标题\n\n**中文** [链接](https://example.test)\n\n## 相同标题\n\n<script>private-script</script>";
    const parsed = publicationMarkdown(markdown);
    expect(parsed.headings).toEqual([{ id: "section-1", title: "相同标题", depth: 2 }, { id: "section-2", title: "相同标题", depth: 2 }]);
    expect(parsed.plainText).toContain("中文 链接"); expect(parsed.plainText).not.toContain("private-script");
    expect(Array.from(suggestedSummary("😀".repeat(201)))).toHaveLength(200);
  });
  it("waits for the latest input when publish starts during an in-flight autosave", async () => {
    const saved: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const scheduler = createSaveScheduler({ initialVersion: 1, cadence: { localBackupMs: 1000, idleSaveMs: 3000, maxSaveMs: 30000 }, snapshot: () => ({ title: "标题", markdown: "正文", summary: "" }), backup() {}, onState() {},
      save: async (payload) => { saved.push(payload.revision); if (payload.revision === 1) await gate; return { ok: true, version: payload.baseVersion + 1 }; },
    });
    try {
      scheduler.input(); const first = scheduler.saveNow(); scheduler.input();
      const confirmation = scheduler.flush(); release(); await first;
      expect(await confirmation).toEqual({ version: 3, revision: 2 }); expect(saved).toEqual([1, 2]);
    } finally { scheduler.destroy(); }
  });
  it("never produces a publish confirmation after a failed or conflicting save", async () => {
    for (const kind of ["failure", "conflict"] as const) {
      const scheduler = createSaveScheduler({ initialVersion: 1, cadence: { localBackupMs: 1000, idleSaveMs: 3000, maxSaveMs: 30000 }, snapshot: () => ({ title: "标题", markdown: "正文", summary: "" }), backup() {}, onState() {}, save: async () => ({ ok: false, kind }) });
      try { scheduler.input(); expect(await scheduler.flush()).toBeNull(); } finally { scheduler.destroy(); }
    }
  });
});
