/**
 * 认证路由（6 操作）——从 nexharness `app/api/auth/[...operation]/route.ts`
 * 移植到 Hono，并按"消费方模型"扩展回跳语义：
 *
 * - returnTo 两类：站内相对路径 / 允许名单内的外部地址（消费方或桌面深链）。
 * - 外部回跳时签发一次性 ticket（`?ticket=`），消费方凭票据换会话
 *   （见 server/routes/consumer.ts 的 /session/resolve）。
 * - 站内回跳保持原语义（登录后直接回 auth-center 门户页面）。
 *
 * 操作清单（POST 需同源；GET 无身体操作）：
 *   GET  /api/auth/external-methods   外部认证区配置（登录页渲染用）
 *   GET  /api/auth/sso                发起企业 SSO（设置 state cookie 后 302 到 IdP）
 *   GET  /api/auth/callback           IdP 回调（校验 state → 建会话 → 回跳）
 *   POST /api/auth/login              本地账号密码登录
 *   POST /api/auth/setup-password     首次设密
 *   POST /api/auth/logout             登出（撤销本地会话 + 可选外部注销跳转）
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { consumerConfig } from "@/lib/config";
import { apiError, apiSuccess, getRequestId } from "@/lib/http";
import { getIdentityExtensions } from "@/lib/identity/identity-extension-bootstrap";
import {
  PasswordEnrollmentError,
  completePasswordEnrollment,
  establishExternalSession,
  localAuthenticationProvider,
} from "@/lib/identity/local-authentication";
import { PASSWORD_MAX_LENGTH, isPasswordAcceptable } from "@/lib/identity/password-strength";
import { acceptAuthenticatedEvidence, authErrorResponse } from "@/lib/identity/resolver";
import {
  type ReturnTarget,
  isSameOriginBrowserRequest,
  publicOrigin,
  readCookie,
  resolveReturnTarget,
  serializeExpiredNamedCookie,
  serializeExpiredSessionCookie,
  serializeFlowCookie,
  serializeSessionCookie,
  withTicket,
} from "@/server/lib/http-kit";
import { issueTicket } from "@/server/lib/tickets";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

export const authRoutes = new Hono();

authRoutes.get("/:operation", (c) => handle(c as Context, "GET"));
authRoutes.post("/:operation", (c) => handle(c as Context, "POST"));

const AUTH_OPERATIONS = [
  "login",
  "sso",
  "callback",
  "setup-password",
  "logout",
  "external-methods",
] as const;
type AuthOperation = (typeof AUTH_OPERATIONS)[number];

const SSO_STATE_COOKIE_NAME = "nex_sso_state";
const SSO_RETURN_TO_COOKIE_NAME = "nex_sso_return_to";
const SSO_FLOW_TTL_SECONDS = 10 * 60;

const loginSchema = z.object({
  account: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(1024),
});

const passwordSetupSchema = z
  .object({
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    confirmPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .strict()
  .refine((value) => value.password === value.confirmPassword, {
    message: "两次输入的密码不一致",
    path: ["confirmPassword"],
  });

function isAuthOperation(value: string): value is AuthOperation {
  return (AUTH_OPERATIONS as readonly string[]).includes(value);
}

async function handle(c: Context, method: "GET" | "POST"): Promise<Response> {
  const requestId = getRequestId(c.req.raw);
  const operation = c.req.param("operation") ?? "";
  if (!isAuthOperation(operation)) {
    return apiError("REQUEST_SCHEMA_INVALID", "认证操作不受支持", { requestId });
  }
  const allowedOrigins = consumerConfig.allowedOrigins;
  if (method === "POST" && !isSameOriginBrowserRequest(c, allowedOrigins)) {
    return apiError("ACCESS_DENIED", "拒绝跨站认证请求", { requestId });
  }
  try {
    return await dispatch(c, operation, method, requestId, allowedOrigins);
  } catch (error) {
    const mapped = authErrorResponse(error, requestId);
    if (mapped) return mapped;
    throw error;
  }
}

async function dispatch(
  c: Context,
  operation: AuthOperation,
  method: "GET" | "POST",
  requestId: string,
  allowedOrigins: ReadonlySet<string>,
): Promise<Response> {
  const { authenticationProvider, profileSource } = await getIdentityExtensions();

  if (operation === "external-methods") {
    if (method !== "GET") {
      return apiError("REQUEST_SCHEMA_INVALID", "external-methods 只支持 GET", { requestId });
    }
    const returnTo = c.req.query("returnTo") ?? "/";
    if (resolveReturnTarget(returnTo, allowedOrigins).kind === "invalid") {
      return apiError("REQUEST_SCHEMA_INVALID", "returnTo 不在允许的回跳名单中", { requestId });
    }
    const externalAuth = authenticationProvider.describeExternalAuth
      ? await authenticationProvider.describeExternalAuth({ returnTo })
      : null;
    return apiSuccess(
      { external_auth: externalAuth },
      {
        headers: { "cache-control": "no-store" },
      },
    );
  }

  if (operation === "sso") {
    if (method !== "GET") {
      return apiError("REQUEST_SCHEMA_INVALID", "sso 只支持 GET", { requestId });
    }
    const returnTo = c.req.query("returnTo") ?? "/";
    if (resolveReturnTarget(returnTo, allowedOrigins).kind === "invalid") {
      return apiError("REQUEST_SCHEMA_INVALID", "returnTo 不在允许的回跳名单中", { requestId });
    }
    if (!authenticationProvider.beginExternalLogin) {
      return apiError("FEATURE_NOT_READY", "当前认证提供器未声明企业登录操作", { requestId });
    }
    const state = randomBytes(32).toString("base64url");
    const callbackBase = getDesktopRendererOrigin(c) ?? publicOrigin(c);
    const callbackUrl = new URL("/api/auth/callback", callbackBase).toString();
    const redirect = await authenticationProvider.beginExternalLogin({
      request: c.req.raw,
      callbackUrl,
      returnTo,
      state,
    });
    const headers = new Headers({ location: redirect.location });
    headers.append(
      "set-cookie",
      serializeFlowCookie(c, SSO_STATE_COOKIE_NAME, state, SSO_FLOW_TTL_SECONDS),
    );
    headers.append(
      "set-cookie",
      serializeFlowCookie(
        c,
        SSO_RETURN_TO_COOKIE_NAME,
        encodeURIComponent(returnTo),
        SSO_FLOW_TTL_SECONDS,
      ),
    );
    return new Response(null, { status: 302, headers });
  }

  if (operation === "callback") {
    if (method !== "GET") {
      return apiError("REQUEST_SCHEMA_INVALID", "callback 只支持 GET", { requestId });
    }
    if (!authenticationProvider.completeExternalLogin) {
      return apiError("FEATURE_NOT_READY", "当前认证提供器未声明企业回调操作", { requestId });
    }
    const expectedState = readCookie(c.req.raw.headers, SSO_STATE_COOKIE_NAME);
    const actualState = c.req.query("state") ?? null;
    if (!expectedState || !actualState || !equalOpaqueValues(expectedState, actualState)) {
      return apiError("ACCESS_DENIED", "企业登录状态校验失败，请重新登录", { requestId });
    }
    const returnTo = decodeReturnTo(
      readCookie(c.req.raw.headers, SSO_RETURN_TO_COOKIE_NAME),
      allowedOrigins,
    );
    const result = await authenticationProvider.completeExternalLogin(c.req.raw);
    if (result.status === "unauthenticated") {
      return apiError("AUTHENTICATION_REQUIRED", "企业认证未完成", { requestId });
    }
    if (result.status === "denied") {
      return apiError("ACCESS_DENIED", result.reason, { requestId });
    }
    const loginAccount = result.evidence.loginAccount?.trim().toLowerCase();
    if (!loginAccount || loginAccount.length > 128) {
      return apiError("ACCESS_DENIED", "企业认证结果缺少有效账号", { requestId });
    }
    const principal = await acceptAuthenticatedEvidence(result.evidence, "employee", {
      profileSource,
    });
    const session = await establishExternalSession({
      userIdentityId: principal.userIdentityId,
      loginAccount,
    });
    const destination =
      session.status === "password_setup_required"
        ? `${publicOrigin(c)}/setup-password?returnTo=${encodeURIComponent(returnTo)}`
        : callbackDestination(
            c,
            resolveReturnTarget(returnTo, allowedOrigins),
            session.sessionToken,
          );
    // Desktop 回调请求经过本机 renderer proxy；必须把最终页面也回到该
    // loopback origin，否则 Electron 会跟随到 Server origin。浏览器请求没有
    // 该受信 header，仍按公开 Server origin 回跳。
    const headers = new Headers({ location: destination });
    headers.append(
      "set-cookie",
      serializeSessionCookie(c, session.sessionToken, session.expiresAt),
    );
    headers.append("set-cookie", serializeExpiredNamedCookie(c, SSO_STATE_COOKIE_NAME));
    headers.append("set-cookie", serializeExpiredNamedCookie(c, SSO_RETURN_TO_COOKIE_NAME));
    return new Response(null, { status: 302, headers });
  }

  if (operation === "login") {
    if (method !== "POST") {
      return apiError("REQUEST_SCHEMA_INVALID", "login 只支持 POST", { requestId });
    }
    const target = resolveReturnTarget(c.req.query("returnTo"), allowedOrigins);
    if (target.kind === "invalid") {
      return apiError("REQUEST_SCHEMA_INVALID", "returnTo 不在允许的回跳名单中", { requestId });
    }
    if (!authenticationProvider.login) {
      return apiError("FEATURE_NOT_READY", "当前认证提供器未声明 login 操作", { requestId });
    }
    const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return apiError("REQUEST_SCHEMA_INVALID", "请输入有效的账号和密码", { requestId });
    }
    const result = await authenticationProvider.login(parsed.data);
    if (result.status === "rate_limited") {
      const response = apiError("RATE_LIMITED", "尝试次数过多，请稍后再试", {
        requestId,
        details: { retry_after_seconds: result.retryAfterSeconds },
      });
      response.headers.set("retry-after", String(result.retryAfterSeconds));
      return response;
    }
    if (result.status === "denied") {
      return apiError("AUTHENTICATION_REQUIRED", "账号或密码错误", { requestId });
    }
    const destination = postLoginDestination(c, target, result.sessionToken);
    return apiSuccess(
      {
        authenticated: true,
        return_to: destination.uiReturnTo,
        ...(destination.redirectTo ? { redirect_to: destination.redirectTo } : {}),
        user: {
          account: result.user.account,
          email: result.user.email,
          display_name: result.user.displayName,
        },
      },
      {
        headers: {
          "set-cookie": serializeSessionCookie(c, result.sessionToken, result.expiresAt),
        },
      },
    );
  }

  if (operation === "setup-password") {
    if (method !== "POST") {
      return apiError("REQUEST_SCHEMA_INVALID", "setup-password 只支持 POST", { requestId });
    }
    const target = resolveReturnTarget(c.req.query("returnTo"), allowedOrigins);
    if (target.kind === "invalid") {
      return apiError("REQUEST_SCHEMA_INVALID", "returnTo 不在允许的回跳名单中", { requestId });
    }
    const parsed = passwordSetupSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return apiError("REQUEST_SCHEMA_INVALID", "密码长度需 8-128 个字符，且两次输入必须一致", {
        requestId,
      });
    }
    if (!isPasswordAcceptable(parsed.data.password)) {
      return apiError("PASSWORD_TOO_WEAK", "密码强度不足：请避免常见密码并增加长度或字符种类", {
        requestId,
      });
    }
    try {
      const result = await completePasswordEnrollment({
        headers: c.req.raw.headers,
        password: parsed.data.password,
      });
      const destination = postLoginDestination(c, target, result.sessionToken);
      return apiSuccess(
        {
          authenticated: true,
          return_to: destination.uiReturnTo,
          ...(destination.redirectTo ? { redirect_to: destination.redirectTo } : {}),
        },
        {
          headers: {
            "set-cookie": serializeSessionCookie(c, result.sessionToken, result.expiresAt),
          },
        },
      );
    } catch (error) {
      if (!(error instanceof PasswordEnrollmentError)) throw error;
      return apiError("ACCESS_DENIED", "首次设密会话不存在、已失效或账号已完成设密", {
        requestId,
      });
    }
  }

  // logout
  if (method !== "POST") {
    return apiError("REQUEST_SCHEMA_INVALID", "logout 只支持 POST", { requestId });
  }
  // 平台会话撤销必须先成功；企业扩展失败不能保留本地登录。
  if (!localAuthenticationProvider.logout) throw new Error("Local logout unavailable");
  await localAuthenticationProvider.logout({ headers: c.req.raw.headers });
  let redirectTo: string | undefined;
  let externalLogout: "redirect" | "unavailable" | undefined;
  if (authenticationProvider !== localAuthenticationProvider && authenticationProvider.logout) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        authenticationProvider.logout({
          headers: c.req.raw.headers,
          returnToUrl: new URL("/login", publicOrigin(c)).toString(),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("external logout timed out")), 3000);
        }),
      ]);
      if (result) {
        const destination = new URL(result.location);
        if (destination.protocol !== "https:" || destination.username || destination.password)
          throw new Error("invalid external logout destination");
        redirectTo = destination.toString();
        externalLogout = "redirect";
      }
    } catch {
      externalLogout = "unavailable";
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const headers = new Headers({ "cache-control": "no-store" });
  headers.append("set-cookie", serializeExpiredSessionCookie(c));
  headers.append("set-cookie", serializeExpiredNamedCookie(c, SSO_STATE_COOKIE_NAME));
  headers.append("set-cookie", serializeExpiredNamedCookie(c, SSO_RETURN_TO_COOKIE_NAME));
  return apiSuccess(
    {
      loggedOut: true,
      ...(redirectTo ? { redirectTo } : {}),
      ...(externalLogout ? { externalLogout } : {}),
    },
    { headers },
  );
}

type PostLoginDestination = {
  /** 站内路径或带 ticket 的外部地址（登录表单直接跳转用）。 */
  uiReturnTo: string;
  /** 外部回跳时与 uiReturnTo 相同；站内时为 undefined。 */
  redirectTo?: string;
};

/**
 * 登录完成后的最终去向：
 * - 站内相对路径：返回门户地址（auth-center 页面）。
 * - 外部地址：签发一次性票据并附加 `?ticket=`（消费方换取会话）。
 */
function postLoginDestination(
  c: Context,
  target: ReturnTarget,
  sessionToken: string,
): PostLoginDestination {
  if (target.kind === "relative") {
    const base = getDesktopRendererOrigin(c) ?? publicOrigin(c);
    return { uiReturnTo: new URL(target.path, base).toString() };
  }
  if (target.kind === "external") {
    const ticket = issueTicket({ sessionToken, returnTo: target.url });
    const url = withTicket(target.url, ticket);
    return { uiReturnTo: url, redirectTo: url };
  }
  // 理论上不可达（调用前已校验）；兜底回门户首页。
  return { uiReturnTo: new URL("/", publicOrigin(c)).toString() };
}

/** callback 场景使用：直接返回最终跳转地址（Location）。 */
function callbackDestination(c: Context, target: ReturnTarget, sessionToken: string): string {
  if (target.kind === "relative") {
    const base = getDesktopRendererOrigin(c) ?? publicOrigin(c);
    return new URL(target.path, base).toString();
  }
  if (target.kind === "external") {
    return withTicket(target.url, issueTicket({ sessionToken, returnTo: target.url }));
  }
  return new URL("/", publicOrigin(c)).toString();
}

/**
 * Desktop 本地代理为 SSO 请求注入的回调 origin。
 * 只接受 loopback HTTP origin，避免任意 Header 改写 OAuth callback。
 */
function getDesktopRendererOrigin(c: Context): string | null {
  const value = c.req.header("x-nexharness-desktop-origin")?.trim();
  if (!value) return null;
  try {
    const origin = new URL(value);
    if (
      origin.protocol !== "http:" ||
      (origin.hostname !== "localhost" && origin.hostname !== "127.0.0.1") ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    ) {
      return null;
    }
    return origin.origin;
  } catch {
    return null;
  }
}

function decodeReturnTo(value: string | null, allowedOrigins: ReadonlySet<string>): string {
  if (!value) return "/";
  try {
    const decoded = decodeURIComponent(value);
    return resolveReturnTarget(decoded, allowedOrigins).kind === "invalid" ? "/" : decoded;
  } catch {
    return "/";
  }
}

function equalOpaqueValues(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
