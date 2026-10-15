import { z } from "zod";
import type { Pool } from "pg";
import { AppError } from "../../contracts/errors";
import { withTransaction } from "../../infrastructure/db/transaction";
import { requireWritableActor } from "../foundation/idempotency";
import type { mediaService } from "../media/service";
import { nicknameSchema } from "./policy";

export const profileSchema = z.strictObject({
  nickname: nicknameSchema,
  bio: z.string().max(200),
  avatarMediaId: z.uuid().nullable(),
});

export type ProfileDto = { id: string; nickname: string; bio: string; avatarMediaId: string | null };

/**
 * 本人资料修改：昵称与简介按字段边界校验，头像必须是本人已完成上传的媒体，
 * 不能引用他人私有图片（复用媒体引用校验，与其他写入一致）。
 */
export function profileService(options: { pool: Pool; media: ReturnType<typeof mediaService> }) {
  const { pool, media } = options;

  async function update(input: { actorId: string; nickname: string; bio: string; avatarMediaId: string | null }): Promise<ProfileDto> {
    const parsed = profileSchema.safeParse({ nickname: input.nickname, bio: input.bio, avatarMediaId: input.avatarMediaId });
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.length ? String(issue.path[0]) : "form";
        const message = field === "nickname" ? "昵称需要 2–30 个字符。" : field === "bio" ? "简介最多 200 个字符。" : field === "avatarMediaId" ? "头像引用无效。" : "请求包含不支持的字段。";
        (fieldErrors[field] ??= []).push(message);
      }
      throw new AppError("VALIDATION_FAILED", 400, "资料不符合字段规则。", fieldErrors);
    }
    return withTransaction(pool, async (tx) => {
      await requireWritableActor(tx, input.actorId);
      if (parsed.data.avatarMediaId) await media.validateReferences(tx, input.actorId, [parsed.data.avatarMediaId]);
      const updated = await tx.client.query<{ id: string; nickname: string; bio: string; avatar_media_id: string | null }>(
        "UPDATE users SET nickname=$2,bio=$3,avatar_media_id=$4 WHERE id=$1 RETURNING id,nickname,bio,avatar_media_id",
        [input.actorId, parsed.data.nickname, parsed.data.bio, parsed.data.avatarMediaId]);
      if (!updated.rowCount) throw new AppError("UNAUTHENTICATED", 401, "请先登录。");
      const row = updated.rows[0];
      return { id: row.id, nickname: row.nickname, bio: row.bio, avatarMediaId: row.avatar_media_id };
    });
  }

  async function loadMine(actorId: string): Promise<ProfileDto> {
    const row = (await pool.query<{ id: string; nickname: string; bio: string; avatar_media_id: string | null }>(
      "SELECT id,nickname,bio,avatar_media_id FROM users WHERE id=$1", [actorId])).rows[0];
    if (!row) throw new AppError("UNAUTHENTICATED", 401, "请先登录。");
    return { id: row.id, nickname: row.nickname, bio: row.bio, avatarMediaId: row.avatar_media_id };
  }

  return { update, loadMine };
}
