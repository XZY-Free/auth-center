/**
 * 门户页面共用的 returnTo 读取。
 *
 * 保留站内相对路径与外部地址（外部地址由服务端按 AUTH_CENTER_ALLOWED_ORIGINS
 * 终审，本函数只做明显非法值兜底），默认回门户首页。
 */
export function readReturnTo(value: string | null): string {
  if (!value) return "/";
  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.includes("\\")) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol === "javascript:" || url.protocol === "data:" || url.protocol === "blob:") {
      return "/";
    }
    return trimmed;
  } catch {
    return "/";
  }
}
