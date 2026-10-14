/**
 * 客户端 API 请求统一入口。
 *
 * 部署在子路径时通过构建变量注入 basePath；未配置（本地开发）时为空串，
 * apiPath / apiFetch 为零开销恒等。
 */
const BASE_PATH =
  (typeof process !== "undefined" && process.env?.AUTH_CENTER_PUBLIC_BASE_PATH) || "";

/** 给应用内 API 路径拼 basePath 前缀（仅处理 "/" 开头的同源路径）。 */
export function apiPath(path: string): string {
  if (!BASE_PATH) return path;
  if (!path.startsWith("/")) return path;
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) return path;
  return `${BASE_PATH}${path}`;
}

/** fetch 包装：自动拼 basePath。 */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiPath(path), init);
}
