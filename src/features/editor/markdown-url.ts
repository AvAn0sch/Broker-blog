const ALLOWED_PROTOCOLS = ["http:", "https:", "mailto:"];

/** 链接只允许批准的协议；站内相对地址可用，javascript:/data: 等一律丢弃。 */
export function safeUrl(url: string | undefined | null): string {
  const value = (url ?? "").trim();
  if (value === "") return "";
  if (value.startsWith("/") || value.startsWith("#")) return value;
  try {
    const parsed = new URL(value, "https://link.invalid");
    return ALLOWED_PROTOCOLS.includes(parsed.protocol) ? value : "";
  } catch { return ""; }
}

/** 预览与公开正文共用的 Markdown 规则：禁用原始 HTML，只渲染允许的链接协议。 */
export function markdownClassNames(kind: "preview" | "article" = "preview") { return `markdown-body markdown-${kind}`; }
