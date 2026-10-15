/** 统一的时间展示：固定时区，避免服务端与浏览器渲染不一致。 */
const TIME_ZONE = "Asia/Hong_Kong";

export function formatPublished(value: string) {
  return new Date(value).toLocaleDateString("zh-CN", { timeZone: TIME_ZONE, year: "numeric", month: "long", day: "numeric" });
}

export function formatMoment(value: string) {
  return new Date(value).toLocaleString("zh-CN", { timeZone: TIME_ZONE });
}
