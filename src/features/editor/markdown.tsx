import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { markdownClassNames, safeUrl } from "./markdown-url";
import { remarkHeadingIds } from "@/modules/content/markdown";
import { CodeBlock } from "./code-block";

/** 预览与公开正文共用同一渲染规则：GFM、代码高亮、无原始 HTML、链接协议白名单。 */
export function Markdown({ content, kind = "preview" }: { content: string; kind?: "preview" | "article" }) {
  return (
    <div className={markdownClassNames(kind)}>
      <ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkHeadingIds]} rehypePlugins={[rehypeHighlight]} urlTransform={safeUrl}
        components={{
          ...(kind === "article" ? { pre: ({ children }) => <CodeBlock>{children}</CodeBlock> } : {}),
          img: ({ src, alt }) => typeof src === "string" && /^\/api\/v1\/media\/[0-9a-f-]{36}$/.test(src) ? <img src={src} alt={alt ?? ""} loading="lazy" /> : <span>〔图片未上传〕</span>,
        }}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
