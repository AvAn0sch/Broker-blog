import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { markdownClassNames, safeUrl } from "./markdown-url";

/** 预览与公开正文共用同一渲染规则：GFM、代码高亮、无原始 HTML、链接协议白名单。 */
export function Markdown({ content, kind = "preview" }: { content: string; kind?: "preview" | "article" }) {
  return (
    <div className={markdownClassNames(kind)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} urlTransform={safeUrl}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
