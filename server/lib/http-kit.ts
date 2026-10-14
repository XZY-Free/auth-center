/**
 * Hono 路由共享 HTTP 工具。
 *
 * 从原 nexharness `app/api/auth/[...operation]/route.ts` 的私有工具迁出，
 * 适配 auth-center 独立部署（无 basePath，根路径服务）：
 * - cookie 序列化统一 Path=/（不再需要子路径 basePath 处理）。
 * - 回跳目标（returnTo）允许两类：站内相对路径 与 允许名单内的外部地址
 *   （http/https origin 或自定义 scheme，如桌面深链 `nexharness:`）。
 */
import { SESSION_COOKIE_NAME } from "@/lib/identity/local-authentication";
import type { Context } from "hono";

/** 读取请求 cookie；缺失返回 null。 */
export function readCookie(headers: Headers, name: string): string | null {
  const raw = headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value || null;
  }
  return null;
}

/** 请求是否来自 https（直连或反向代理转发）。 */
export function isSecureRequest(c: Context): boolean {
  const forwardedProto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  return new URL(c.req.url).protocol === "https:" || forwardedProto === "https";
}

/** 服务对外可见的 origin（优先反向代理转发头）。 */
export function publicOrigin(c: Context): string {
  const forwardedProto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = c.req.header("x-forwarded-host")?.split(",")[0]?.trim();
  const url = new URL(c.req.url);
  const protocol = forwardedProto || url.protocol.replace(":", "");
  const host = forwardedHost || c.req.header("host") || url.host;
  return `${protocol}://${host}`;
}

/**
 * 浏览器提交 Origin 时必须与服务 origin（或允许名单）一致；无 Origin 的服务调用可用。
 * 允许名单覆盖开发期反向代理（如 vite :3101 → :3100）造成的 host 差异。
 */
export function isSameOriginBrowserRequest(
  c: Context,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  const origin = c.req.header("origin");
  if (!origin) return true;
  if (origin === "null") return false;
  if (allowedOrigins.has(origin)) return true;
  const forwardedProto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = c.req.header("x-forwarded-host")?.split(",")[0]?.trim();
  const url = new URL(c.req.url);
  const expectedProtocol = forwardedProto || url.protocol.replace(":", "");
  const expectedHost = forwardedHost || c.req.header("host") || url.host;
  try {
    return new URL(origin).origin === `${expectedProtocol}://${expectedHost}`;
  } catch {
    return false;
  }
}

/** 序列化命名 cookie（auth-center 根路径服务，Path 固定 /）。 */
export function serializeNamedCookie(
  c: Context,
  name: string,
  value: string,
  lifetime: string,
): string {
  return [
    `${name}=${value}`,
    "Path=/",
    lifetime,
    "HttpOnly",
    "SameSite=Lax",
    isSecureRequest(c) ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

/** 会话 cookie：带 Expires 与 Max-Age。 */
export function serializeSessionCookie(c: Context, token: string, expiresAt: Date): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return serializeNamedCookie(
    c,
    SESSION_COOKIE_NAME,
    token,
    `Expires=${expiresAt.toUTCString()}; Max-Age=${maxAge}`,
  );
}

/** 过期会话 cookie（登出）。 */
export function serializeExpiredSessionCookie(c: Context): string {
  return serializeNamedCookie(
    c,
    SESSION_COOKIE_NAME,
    "",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0",
  );
}

/** 过期命名 cookie（清 SSO 流状态）。 */
export function serializeExpiredNamedCookie(c: Context, name: string): string {
  return serializeNamedCookie(c, name, "", "Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0");
}

/** SSO 流 cookie（TTL 秒）。 */
export function serializeFlowCookie(
  c: Context,
  name: string,
  value: string,
  maxAgeSeconds: number,
): string {
  return serializeNamedCookie(c, name, value, `Max-Age=${maxAgeSeconds}`);
}

/**
 * 从 Authorization: Bearer 提取凭证（服务端消费者用）。
 */
export function extractBearerToken(headers: Headers): string | null {
  const raw = headers.get("authorization");
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match?.[1]?.trim() || null;
}

/**
 * 消费方凭证：优先 Bearer（服务端调用），其次会话 cookie（浏览器/共享 cookie 开发期）。
 */
export function consumerCredential(headers: Headers): string | null {
  return extractBearerToken(headers) ?? readCookie(headers, SESSION_COOKIE_NAME);
}

/**
 * 把凭证归一为会话 cookie 形态，供认证链（authenticate → resolvePrincipal）复用。
 * Bearer 存在时覆盖 cookie 头；否则原样透传（浏览器 cookie 已在头中）。
 */
export function headersWithSessionCredential(headers: Headers, token: string): Headers {
  const normalized = new Headers(headers);
  normalized.set("cookie", `${SESSION_COOKIE_NAME}=${token}`);
  normalized.delete("authorization");
  return normalized;
}

/** 回跳目标解析结果。 */
export type ReturnTarget =
  | { readonly kind: "relative"; readonly path: string }
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "invalid" };

/** 站内相对路径：以 / 开头、非 //、不含反斜杠。 */
export function isRelativeReturnTo(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}

/**
 * 解析 returnTo：
 * - 相对路径 → 站内（auth-center 门户内页面）。
 * - http/https 绝对地址 → origin 必须在允许名单。
 * - 其他 scheme（桌面深链）→ scheme（如 `nexharness:`）必须在允许名单。
 */
export function resolveReturnTarget(
  raw: string | null | undefined,
  allowedOrigins: ReadonlySet<string>,
): ReturnTarget {
  const value = raw?.trim() || "/";
  if (isRelativeReturnTo(value)) return { kind: "relative", path: value };
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return allowedOrigins.has(url.origin)
        ? { kind: "external", url: url.toString() }
        : { kind: "invalid" };
    }
    if (url.protocol === "javascript:" || url.protocol === "data:" || url.protocol === "blob:") {
      return { kind: "invalid" };
    }
    return allowedOrigins.has(url.protocol)
      ? { kind: "external", url: url.toString() }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

/** 在回跳地址附加一次性票据查询参数。 */
export function withTicket(url: string, ticket: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("ticket", ticket);
  return parsed.toString();
}
