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
 *   POST /api/enterprise/user-context     企业用户上下文装配（agent 执行链，会话主体=目标用户）
 *
 * 凭证：`Authorization: Bearer <sessionToken>`（服务端调用）或 `nex_session`
 * cookie（浏览器/开发期共享 cookie）。auth-center 不可达时消费方对实时操作
 * fail-closed。
 */
import { db } from "@/lib/db/client";
import { apiError, apiSuccess, getRequestId, resourceNotFound } from "@/lib/http";
import { assertActionResourceTypeMatch, isKnownActionCode } from "@/lib/identity/action-codes";
import type { ActionScopeRequest } from "@/lib/identity/authorization";
import {
  type EnterpriseUserAccessPolicy,
  EnterpriseUserContextRequirementError,
  parseEnterpriseUserAccessPolicy,
} from "@/lib/identity/enterprise-user-access-policy";
import { getIdentityExtensions } from "@/lib/identity/identity-extension-bootstrap";
import { evaluatePermission, loadPermissionContext } from "@/lib/identity/permission-context";
import { buildPermissionSnapshot } from "@/lib/identity/permission-snapshot";
import {
  type EnterpriseUserContextCandidate,
  prepareEnterpriseUserContext,
} from "@/lib/identity/prepare-enterprise-user-context";
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

// ─── 企业用户上下文（执行链装配：nexharness agent 执行链经此消费）──────────

/**
 * 企业用户上下文装配（POST /api/enterprise/user-context）。
 *
 * 契约（消费方模型 v4）：nexharness 不再持有企业资料读写与刷新编排——执行链在
 * 创建 AgentCall 前经本接口装配"企业用户上下文候选"：
 * - 调用凭证 = 目标用户自己的会话（Bearer/cookie）；(tenantId, userIdentityId) 必须与主体一致。
 * - profileRequirement=none → `{ candidate: null }`（调用方通常直接跳过本接口）。
 * - 资料来源（EnterpriseProfileSource）由部署装配；开源部署无资料源时返回 409
 *   ENTERPRISE_USER_CONTEXT_UNAVAILABLE（与既有"当前部署没有受信企业资料来源"一致）。
 * - 候选含最终复核证据（evidence）；消费方在绑定创建事务内做本地终稿复核（纯函数，
 *   无跨服务调用——见 nexharness `finalizeEnterpriseUserContextCandidate`）。
 */
const enterpriseUserContextSchema = z
  .object({
    tenantId: z.string().min(1).max(64),
    userIdentityId: z.string().min(1).max(64),
    profileRequirement: z.enum(["none", "stale_allowed", "fresh_required"]),
    allowedFields: z.array(z.string().min(1).max(96)).max(64),
    /** ISO 8601 绝对截止（可选）；缺失时服务端按 10s 本地上限保护。 */
    deadlineAt: z.string().max(64).optional(),
  })
  .strict();

/** 候选序列化：Date → ISO（消费方还原为 Date 后进本地复核）。 */
function serializeEnterpriseCandidate(candidate: EnterpriseUserContextCandidate) {
  return {
    publicContext: candidate.publicContext,
    evidence: {
      ...candidate.evidence,
      lastVerifiedAt: candidate.evidence.lastVerifiedAt.toISOString(),
      freshUntil: candidate.evidence.freshUntil.toISOString(),
      staleUntil: candidate.evidence.staleUntil.toISOString(),
    },
  };
}

consumerRoutes.post(
  "/enterprise/user-context",
  handleConsumer(async (c, requestId) => {
    const session = await requireSession(c);
    const parsed = enterpriseUserContextSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return apiError("REQUEST_SCHEMA_INVALID", "企业上下文请求体无效", { requestId });
    }
    const { tenantId, userIdentityId, profileRequirement, allowedFields } = parsed.data;
    if (
      session.principal.tenantId !== tenantId ||
      session.principal.userIdentityId !== userIdentityId
    ) {
      return apiError("ACCESS_DENIED", "调用主体与目标用户不一致", { requestId });
    }
    if (profileRequirement === "none") {
      return apiSuccess({ candidate: null }, { headers: { "cache-control": "no-store" } });
    }
    let deadlineAt: Date | undefined;
    if (parsed.data.deadlineAt !== undefined) {
      const parsedDeadline = new Date(parsed.data.deadlineAt);
      if (Number.isNaN(parsedDeadline.getTime())) {
        return apiError("REQUEST_SCHEMA_INVALID", "deadlineAt 不是合法 ISO 时间", { requestId });
      }
      deadlineAt = parsedDeadline;
    }
    let policy: EnterpriseUserAccessPolicy;
    try {
      policy = parseEnterpriseUserAccessPolicy({
        enterprise_user_context: {
          profile_requirement: profileRequirement,
          allowed_fields: allowedFields,
        },
      });
    } catch (error) {
      return apiError(
        "REQUEST_SCHEMA_INVALID",
        error instanceof Error ? error.message : "企业资料要求无效",
        { requestId },
      );
    }
    const extensions = await getIdentityExtensions();
    try {
      const candidate = await prepareEnterpriseUserContext({
        tenantId,
        userIdentityId,
        policy,
        source: extensions.profileSource,
        deadlineAt,
      });
      return apiSuccess(
        { candidate: candidate ? serializeEnterpriseCandidate(candidate) : null },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      if (error instanceof EnterpriseUserContextRequirementError) {
        const codeByRequirement = {
          enterprise_user_context_disabled: "ENTERPRISE_USER_CONTEXT_DISABLED",
          enterprise_user_context_not_fresh: "ENTERPRISE_USER_CONTEXT_NOT_FRESH",
          enterprise_user_context_unavailable: "ENTERPRISE_USER_CONTEXT_UNAVAILABLE",
        } as const;
        const code = codeByRequirement[error.code] ?? "ENTERPRISE_USER_CONTEXT_UNAVAILABLE";
        return apiError(code, error.message, { requestId });
      }
      throw error;
    }
  }),
);
