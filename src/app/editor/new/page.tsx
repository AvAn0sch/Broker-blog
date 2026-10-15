import { DraftEditor } from "@/features/editor/editor";
import { pageUser } from "@/modules/identity/http";

export const metadata = { title: "写文章 · Broker Blog" };

export default async function NewArticleEditor() {
  const user = await pageUser({ returnTo: "/editor/new", banned: "blocked" });
  return <DraftEditor mode="new" userId={user.id} />;
}
