/**
 * 管理台公共取数：401 → 跳登录；403/错误 → 受控状态（供 GatePage 渲染）。
 */
import { apiFetch } from "@/lib/api-fetch";

export function redirectToLogin(returnTo: string): void {
  window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

export type ConsoleFetchResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "denied"; status: number; message: string }
  | { kind: "unreachable" };

/**
 * 拉取管理台接口（`{ok,data}` 信封）。
 * - 401：跳登录页并返回 unreachable（页面即将卸载）。
 * - 403：denied（GatePage）。
 * - 其他非 2xx：denied 展示错误消息。
 */
export async function fetchConsole<T>(
  path: string,
  returnTo: string,
): Promise<ConsoleFetchResult<T>> {
  const response = await apiFetch(path).catch(() => null);
  if (!response) return { kind: "unreachable" };
  if (response.status === 401) {
    redirectToLogin(returnTo);
    return { kind: "unreachable" };
  }
  const body = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    return {
      kind: "denied",
      status: response.status,
      message: body?.error?.message ?? "加载失败，请稍后重试",
    };
  }
  return { kind: "ok", data: (body?.data ?? body) as T };
}

/** 解析当前登录用户（用户 id 等），401 时跳登录。 */
export async function fetchCurrentPrincipal(returnTo: string): Promise<{
  userIdentityId: string;
  displayName: string | null;
} | null> {
  const response = await apiFetch("/api/session/introspect", { method: "POST" }).catch(() => null);
  if (!response?.ok) {
    redirectToLogin(returnTo);
    return null;
  }
  const body = (await response.json().catch(() => null)) as {
    principal?: { userIdentityId?: string; displayName?: string | null };
  } | null;
  const userIdentityId = body?.principal?.userIdentityId;
  if (!userIdentityId) {
    redirectToLogin(returnTo);
    return null;
  }
  return { userIdentityId, displayName: body?.principal?.displayName ?? null };
}
