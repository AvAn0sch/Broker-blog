export const feedModes = ["featured", "latest"] as const;
export type FeedMode = (typeof feedModes)[number];

/** B4 列表页大小：首页/标签/作者主页共用一套上限，标签总览单独放宽。 */
export const discoveryPolicy = {
  feed: { defaultLimit: 10, maxLimit: 30 },
  tags: { defaultLimit: 50, maxLimit: 100 },
};

export function feedScope(input: { mode: FeedMode; tagSlug?: string | null; authorId?: string | null }) {
  return `${input.mode}:${input.tagSlug ?? ""}:${input.authorId ?? ""}`;
}
