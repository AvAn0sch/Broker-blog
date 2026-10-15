import { notFound } from "next/navigation";
import { AppError } from "@/contracts/errors";
import { DraftEditor } from "@/features/editor/editor";
import { content } from "@/modules/content/http";
import { pageUser } from "@/modules/identity/http";

export const metadata = { title: "编辑文章 · Broker Blog" };

export default async function ArticleEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser({ returnTo: `/editor/${id}`, banned: "blocked" });
  try {
    const draft = await content().loadDraft({ viewerId: user.id, articleId: id });
    return <DraftEditor mode="draft" userId={user.id} draft={{ articleId: draft.articleId, version: draft.version, title: draft.title, markdown: draft.markdown, summary: draft.summary }} />;
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
}
