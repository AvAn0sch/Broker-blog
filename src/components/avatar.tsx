/** 头像：有已保存头像时读取受控媒体地址，否则显示昵称首字。 */
export function Avatar({ nickname, avatarMediaId, size = "medium", alt }: { nickname: string; avatarMediaId?: string | null; size?: "small" | "medium" | "large"; alt?: string }) {
  const className = `avatar avatar-${size}`;
  if (avatarMediaId) return <img className={className} src={`/api/v1/media/${avatarMediaId}`} alt={alt ?? ""} />;
  return <span className={`${className} avatar-initial`} aria-hidden={alt ? undefined : true} aria-label={alt}>{Array.from(nickname.trim())[0] ?? "·"}</span>;
}
