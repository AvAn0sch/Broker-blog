/** B1 固定的媒体参数：格式、5 MiB 字节边界、上传租约、清理宽限期与限流。 */
export const mediaPolicy = {
  maxBytes: 5 * 1024 * 1024,
  uploadLeaseMs: 60_000,
  orphanGraceMs: 24 * 60 * 60 * 1000,
  limits: {
    upload: { count: 30, ms: 60 * 60 * 1000 },
    global: { count: 300, ms: 60 * 1000 },
  },
};
