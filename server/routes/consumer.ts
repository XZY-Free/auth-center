/**
 * 消费方接口集（nexharness 等系统经此消费 auth-center 身份能力）。
 *
 * 契约（docs/split 施工图 v4"消费方模型"）：
 *   POST /api/session/resolve     一次性票据换会话（登录回跳后服务端换取）
 *   POST /api/session/introspect  会话校验（消费方本地缓存 30~60s）
 *   POST /api/session/revoke      按 token 撤销会话
 *   GET  /api/permissions/snapshot 权限快照（展开的允许清单；缓存 5~15min）
 *   POST /api/authorize           实时授权（变更/敏感操作 100% 实时）
 *   GET  /api/directory/users/:id         用户目录单读（显示用）
 *   POST /api/directory/users/batch       用户目录批量读
 *
 * 凭证：`Authorization: Bearer <sessionToken>`（服务端调用）或 `nex_session`
 * cookie（浏览器/开发期共享 cookie）。auth-center 不可达时消费方对实时操作
 * fail-closed。
 */
import { db } from "@/lib/db/client";
import { apiError, apiSuccess, getRequestId, resourceNotFound } from "@/lib/http";
import { assertActionResourceTypeMatch, isKnownActionCode } from "@/lib/identity/action-codes";
import type { ActionScopeRequest } from "@/lib/identity/authorization";
import { evaluatePermission, loadPermissionContext } from "@/lib/identity/permission-context";
import { buildPermissionSnapshot } from "@/lib/identity/permission-snapshot";
import {
  AuthenticationError,
  type Principal,
  authErrorResponse,
  resolvePrincipal,
} from "@/lib/identity/resolver";
import { isKnownResourceScopeType } from "@/lib/identity/resource-scope";
import { getLiveSessionFactsByToken, revokeSessionByToken } from "@/lib/identity/session-facts";
import { getUserIdentityForTenant } from "@/lib/identity/user-identity-queries";
import { userIdentity } from "@/lib/persistence/schema/identity";
import { consumerCredential, headersWithSessionCredential } from "@/server/lib/http-kit";
import { consumeTicket } from "@/server/lib/tickets";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

export const consumerRoutes = new Hono();

/** 统一异常映射：AuthenticationError → 401；其余上抛（框架 500）。 */
function handleConsumer(
  handler: (c: Context, requestId: string) => Promise<Response>,
): (c: Context) => Promise<Response> {
  return async (c: Context): Promise<Response> => {
    const requestId = getRequestId(c.req.raw);
    try {
      return await handler(c, requestId);
    } catch (error) {
      const mapped = authErrorResponse(error, requestId);
      if (mapped) return mapped;
      throw error;
    }
  };
}

/**
 * 消费方会话凭证解析：Bearer 优先，其次会话 cookie；
 * 归一为 cookie 形态后走统一认证链（含用户停用/租户暂停校验与资料同步）。
 *
 * 无凭证时抛 AuthenticationError，由 handleConsumer 统一映射 401。
 * 注意：不要用 `instanceof Response` 判型——@hono/node-server 会把全局
 * Response 替换为自身包装类（_Response），而 Response.json() 经原型链
 * 产出原生实例，导致 instanceof 恒为 false。
 */
async function requireSession(c: Context): Promise<{ token: string; principal: Principal }> {
  const token = consumerCredential(c.req.raw.headers);
  if (!token) {
    throw new AuthenticationError("missing_identity", "缺少会话凭证");
  }
  const principal = await resolvePrincipal(headersWithSessionCredential(c.req.raw.headers, token));
  return { token, principal };
}

function publicPrincipal(principal: Principal) {
  return {
    tenantId: principal.tenantId,
    tenantKey: principal.tenantKey,
    userIdentityId: principal.userIdentityId,
    externalSubject: principal.externalSubject,
    email: principal.email,
    displayName: principal.displayName,
    audience: principal.audience,
    profileStatus: principal.profileStatus ?? null,
    lastVerifiedAt: principal.lastVerifiedAt?.toISOString() ?? null,
    enterpriseAttributes: principal.enterpriseAttributes ?? {},
  };
}

const resolveSchema = z.object({ ticket: z.string().min(16).max(256) }).strict();

consumerRoutes.post(
  "/session/resolve",
  handleConsumer(async (c, requestId) => {
    const parsed = resolveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return apiError("REQUEST_SCHEMA_INVALID", "请求体需包含有效的 ticket", { requestId });
    }
    const record = consumeTicket(parsed.data.ticket);
    if (!record) {
      return apiError("ACCESS_DENIED", "票据无效、已使用或已过期，请重新登录", { requestId });
    }
    const principal = await resolvePrincipal(
      headersWithSessionCredential(c.req.raw.headers, record.sessionToken),
    );
    const [facts, snapshot] = await Promise.all([
      getLiveSessionFactsByToken(record.sessionToken),
      buildPermissionSnapshot(principal.tenantId, principal.userIdentityId),
    ]);
    if (!facts) {
      return apiError("AUTHENTICATION_REQUIRED", "登录会话已失效", { requestId });
    }
    return apiSuccess(
      {
        principal: publicPrincipal(principal),
        snapshot,
        sessionToken: record.sessionToken,
        expiresAt: facts.expiresAt.toISOString(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  }),
);

consumerRoutes.post(
  "/session/introspect",
  handleConsumer(async (c, requestId) => {
    const session = await requireSession(c);
    const facts = await getLiveSessionFactsByToken(session.token);
    if (!facts) {
      return apiError("AUTHENTICATION_REQUIRED", "登录会话已失效", { requestId });
    }
    return apiSuccess(
      {
        principal: publicPrincipal(session.principal),
        expiresAt: facts.expiresAt.toISOString(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  }),
);

consumerRoutes.post(
  "/session/revoke",
  handleConsumer(async (c, requestId) => {
    const token = consumerCredential(c.req.raw.headers);
    if (!token) {
      return apiError("AUTHENTICATION_REQUIRED", "缺少会话凭证", { requestId });
    }
    const revoked = await revokeSessionByToken(token);
    return apiSuccess({ revoked }, { headers: { "cache-control": "no-store" } });
  }),
);

consumerRoutes.get(
  "/permissions/snapshot",
  handleConsumer(async (c, requestId) => {
    const session = await requireSession(c);
    const snapshot = await buildPermissionSnapshot(
      session.principal.tenantId,
      session.principal.userIdentityId,
    );
    return apiSuccess(snapshot, { headers: { "cache-control": "private, no-store" } });
  }),
);

const authorizeSchema = z
  .object({
    requests: z
      .array(
        z
          .object({
            actionCode: z.string().min(1).max(64),
            resource: z
              .object({
                type: z.string().min(1).max(64),
                id: z.string().min(1).max(128).nullable(),
              })
              .strict(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

consumerRoutes.post(
  "/authorize",
  handleConsumer(async (c, requestId) => {
    const session = await requireSession(c);
    const parsed = authorizeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return apiError("REQUEST_SCHEMA_INVALID", "authorize 请求体无效", { requestId });
    }
    const requests: ActionScopeRequest[] = [];
    for (const item of parsed.data.requests) {
      if (!isKnownActionCode(item.actionCode)) {
        return apiError("REQUEST_SCHEMA_INVALID", `未知动作码: ${item.actionCode}`, { requestId });
      }
      if (!isKnownResourceScopeType(item.resource.type)) {
        return apiError("REQUEST_SCHEMA_INVALID", `未知资源类型: ${item.resource.type}`, {
          requestId,
        });
      }
      try {
        assertActionResourceTypeMatch(item.actionCode, item.resource.type);
      } catch {
        return apiError(
          "REQUEST_SCHEMA_INVALID",
          `动作码与资源类型不匹配: ${item.actionCode}/${item.resource.type}`,
          { requestId },
        );
      }
      requests.push({
        actionCode: item.actionCode,
        resource: { type: item.resource.type, id: item.resource.id },
      });
    }
    const context = await loadPermissionContext(
      session.principal.tenantId,
      session.principal.userIdentityId,
      undefined,
      requests,
    );
    const decisions = requests.map((request) => {
      const decision = evaluatePermission(context, request);
      return {
        actionCode: request.actionCode,
        resource: request.resource,
        allowed: decision.allowed,
        reason: decision.reason,
        sources: decision.sources,
      };
    });
    return apiSuccess(
      { decisions, digest: context.digest },
      { headers: { "cache-control": "no-store" } },
    );
  }),
);

// ─── 目录读（消费方展示用：负责人/成员显示名等）─────────────────────────

function directoryUser(row: typeof userIdentity.$inferSelect) {
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    loginAccount: row.loginAccount,
    status: row.status,
  };
}

consumerRoutes.get(
  "/directory/users/:id",
  handleConsumer(async (c, requestId) => {
    const session = await requireSession(c);
    const userId = c.req.param("id") ?? "";
    const user = await getUserIdentityForTenant(userId, session.principal.tenantId);
    if (!user) return resourceNotFound(requestId);
    return apiSuccess({ user: directoryUser(user) });
  }),
);

const directoryBatchSchema = z
  .object({ ids: z.array(z.string().min(1).max(64)).min(1).max(200) })
  .strict();

consumerRoutes.post(
  "/directory/users/batch",
  handleConsumer(async (c, requestId) => {
    const session = await requireSession(c);
    const parsed = directoryBatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return apiError("REQUEST_SCHEMA_INVALID", "目录批量读请求体无效", { requestId });
    }
    const uniqueIds = [...new Set(parsed.data.ids)];
    const rows = await db
      .select()
      .from(userIdentity)
      .where(
        and(
          eq(userIdentity.tenantId, session.principal.tenantId),
          inArray(userIdentity.id, uniqueIds),
        ),
      );
    return apiSuccess({ users: rows.map(directoryUser) });
  }),
);
