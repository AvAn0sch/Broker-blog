import { ProfileForm } from "@/features/profile/profile-form";
import { pageUser } from "@/modules/identity/http";

export const metadata = { title: "个人设置 · Broker Blog" };

export default async function ProfileSettings() {
  const user = await pageUser({ returnTo: "/settings/profile", banned: "blocked" });
  return (
    <div className="page-scaffold">
      <p className="eyebrow">SETTINGS</p>
      <h1>个人设置</h1>
      <p className="page-sub">向社区介绍一下自己，{user.nickname}。</p>
      <ProfileForm profile={{ id: user.id, nickname: user.nickname, bio: user.bio, avatarMediaId: user.avatarMediaId }} email={user.email} />
    </div>
  );
}
