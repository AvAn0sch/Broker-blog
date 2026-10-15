import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

type Node = { type: string; value?: string; url?: string; alt?: string; identifier?: string; depth?: number; children?: Node[]; data?: { hProperties?: Record<string, string> } };
const parser = unified().use(remarkParse).use(remarkGfm);
const mediaUrl = /^\/api\/v1\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
function walk(node: Node, visit: (node: Node) => void) { visit(node); node.children?.forEach((child) => walk(child, visit)); }
function text(node: Node): string {
  if (["html", "definition"].includes(node.type)) return "";
  if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";
  return node.value ?? node.children?.map(text).join(node.type === "root" || node.type === "list" ? " " : "") ?? "";
}

/** Parse the same CommonMark/GFM grammar as the renderer; code examples are never image references. */
export function publicationMarkdown(markdown: string) {
  const tree = parser.parse(markdown) as Node;
  const definitions = new Map<string, string>();
  walk(tree, (node) => { if (node.type === "definition" && node.identifier && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url ?? ""); });
  const mediaIds = new Set<string>();
  let invalidImage = false;
  const headings: { id: string; title: string; depth: number }[] = [];
  walk(tree, (node) => {
    if (node.type === "image" || node.type === "imageReference") {
      const url = node.type === "image" ? node.url : definitions.get(node.identifier ?? "");
      const match = mediaUrl.exec(url ?? "");
      if (match) mediaIds.add(match[1]); else invalidImage = true;
    }
    if (node.type === "heading") headings.push({ id: `section-${headings.length + 1}`, title: text(node), depth: node.depth ?? 1 });
  });
  return { plainText: text(tree).replace(/\s+/g, " ").trim(), mediaIds: [...mediaIds].sort(), invalidImage, headings };
}

export function suggestedSummary(markdown: string) { return Array.from(publicationMarkdown(markdown).plainText).slice(0, 200).join(""); }

export function remarkHeadingIds() {
  return (tree: Node) => {
    let index = 0;
    walk(tree, (node) => { if (node.type === "heading") node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: `section-${++index}` } }; });
  };
}
