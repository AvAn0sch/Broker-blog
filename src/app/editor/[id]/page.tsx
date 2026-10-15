import { notFound } from "next/navigation";
import { AppError } from "@/contracts/errors";
import { DraftEditor } from "@/features/editor/editor";
import { content } from "@/modules/content/http";
import { pageUser } from "@/modules/identity/http";
import { Markdown } from "@/features/editor/markdown";

export const metadata = { title: "编辑文章 · Broker Blog" };

export default async function ArticleEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser({ returnTo: `/editor/${id}` });
  try {
    const draft = await content().loadDraft({ viewerId: user.id, articleId: id });
    if (user.status === "banned") return <article className="article-paper"><p className="notice" role="status">当前账号已被封禁，仅可查看本人已有内容。</p><h1>{draft.title || "无标题草稿"}</h1><Markdown content={draft.markdown} /><a href="/me/articles">返回内容管理</a></article>;
    return <DraftEditor mode="draft" userId={user.id} draft={draft} />;
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
}
