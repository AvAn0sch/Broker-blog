import { z } from "zod";

/** 编辑器与草稿的固定参数：字段上限与保存节奏（1 秒本地备份、停止输入 3 秒、持续输入最长 30 秒）。 */
export const contentPolicy = {
  title: { max: 100 },
  summary: { max: 200 },
  markdown: { max: 100_000 },
  requestBytes: 524_288,
  autosave: { localBackupMs: 1_000, idleSaveMs: 3_000, maxSaveMs: 30_000 },
};

export const draftContentSchema = z.strictObject({
  title: z.string().max(contentPolicy.title.max),
  markdown: z.string().max(contentPolicy.markdown.max),
  summary: z.string().max(contentPolicy.summary.max),
});

export const draftSaveSchema = z.strictObject({ baseDraftVersion: z.number().int().positive(), ...draftContentSchema.shape });
export const draftCreateSchema = draftContentSchema.partial();

/** 草稿中引用的受控媒体 URL；发布与送审时再强校验 ready 与归属。 */
export function extractMediaIds(markdown: string): string[] {
  const found = new Set<string>();
  for (const match of markdown.matchAll(/\/api\/v1\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g)) found.add(match[1]);
  return [...found];
}
