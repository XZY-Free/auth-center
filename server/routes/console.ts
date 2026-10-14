/**
 * 管理台接口（auth-center 控制台）。
 *
 * 从 nexharness `app/studio/api/settings/*` 与 `app/studio/api/agents/[agent_id]/access`
 * 移植到 Hono；守卫沿用 `requireStudioAction`（会话 → 动作授权）。
 *
 * 契约沿用 `{ ok, data }` / `{ ok, error }` 信封（jsonOk/jsonError）——与移植组件的
 * 消费方式一致（组件只改了接口前缀为 /api/console）。
 *
 * 路由清单：
 *   GET    /api/console/settings/users                成员+角色模板列表（user.manage）
 *   PUT    /api/console/settings/users/:id/roles      成员角色设置（user.manage）
 *   GET    /api/console/settings/permissions          权限管理视图（user.manage）
 *   POST   /api/console/settings/permissions          权限变更 / explain（user.manage）
 *   GET    /api/console/agents                        智能体列表（studio.access，访问管理入口）
 *   GET    /api/console/agents/:id/access             智能体访问设置（studio.access + 负责人/管理）
 *   PUT    /api/console/agents/:id/access             保存访问设置（同上）
 */
import { db } from "@/lib/db/client";
import { jsonError, jsonOk } from "@/lib/http";
import { isKnownActionCode } from "@/lib/identity/action-codes";
import { type ActionScopeRequest, checkActionScope } from "@/lib/identity/authorization";
import { evaluatePermission, loadPermissionContext } from "@/lib/identity/permission-context";
import {
  PermissionManagementError,
  changePermissionManagement,
  listPermissionManagement,
} from "@/lib/identity/permission-management";
import { isKnownResourceScopeType } from "@/lib/identity/resource-scope";
import { listSettingsUserRolesView } from "@/lib/identity/settings-queries";
import { requireStudioAction } from "@/lib/identity/studio-access";
import { agentTable } from "@/lib/persistence/schema/agents";
import { permissionGroup, resourceAccessPolicy } from "@/lib/persistence/schema/authorization";
import { principalBinding } from "@/lib/persistence/schema/identity";
import { and, eq, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";

export const consoleRoutes = new Hono();

// ─── 成员与权限 ──────────────────────────────────────────────────────

consoleRoutes.get("/settings/users", async (c) => {
  const gate = await requireStudioAction(c.req.raw, "user.manage");
  if (!gate.ok) return gate.response;
  const view = await listSettingsUserRolesView(gate.principal.tenantId);
  return jsonOk({ users: view.users, roles: view.roles });
});

consoleRoutes.put("/settings/users/:id/roles", async (c) => {
  const gate = await requireStudioAction(c.req.raw, "user.manage");
  if (!gate.ok) return gate.response;
  const id = c.req.param("id") ?? "";
  const body = (await c.req.json().catch(() => null)) as {
    roleIds?: string[];
    expectedRoleIds?: string[];
  } | null;
  const [principal] = await db
    .select()
    .from(principalBinding)
    .where(
      and(
        eq(principalBinding.tenantId, gate.principal.tenantId),
        eq(principalBinding.subjectType, "user"),
        eq(principalBinding.userIdentityId, id),
      ),
    );
  if (!principal) return jsonError(404, "user_not_found", "成员不存在");
  try {
    const result = await changePermissionManagement(
      gate.principal.tenantId,
      gate.principal.userIdentityId,
      {
        operation: "set_roles",
        principalId: principal.id,
        roleKeys: body?.roleIds,
        expectedRoleKeys: body?.expectedRoleIds,
      },
    );
    return jsonOk({ userId: id, roleIds: result.roleKeys });
  } catch (error) {
    if (error instanceof PermissionManagementError)
      return jsonError(error.status, error.code, error.message);
    return jsonError(500, "update_failed", "角色保存失败");
  }
});

consoleRoutes.get("/settings/permissions", async (c) => {
  const gate = await requireStudioAction(c.req.raw, "user.manage");
  if (!gate.ok) return gate.response;
  return jsonOk(await listPermissionManagement(gate.principal.tenantId));
});

consoleRoutes.post("/settings/permissions", async (c) => {
  const gate = await requireStudioAction(c.req.raw, "user.manage");
  if (!gate.ok) return gate.response;
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    if (body?.operation === "explain") {
      const actionCode = body.actionCode;
      const userId = body.userId;
      const resource = body.resource as { type?: unknown; id?: unknown } | undefined;
      if (
        typeof actionCode !== "string" ||
        !isKnownActionCode(actionCode) ||
        typeof userId !== "string" ||
        typeof resource?.type !== "string" ||
        !isKnownResourceScopeType(resource.type) ||
        (resource.id !== null && typeof resource.id !== "string")
      )
        return jsonError(400, "invalid_input", "权限查询参数无效");
      const request: ActionScopeRequest = {
        actionCode,
        resource: { type: resource.type, id: (resource.id ?? null) as string | null },
      };
      const context = await loadPermissionContext(gate.principal.tenantId, userId, undefined, [
        request,
      ]);
      return jsonOk(evaluatePermission(context, request));
    }
    return jsonOk(
      await changePermissionManagement(
        gate.principal.tenantId,
        gate.principal.userIdentityId,
        body as Record<string, unknown>,
      ),
    );
  } catch (error) {
    if (error instanceof PermissionManagementError)
      return jsonError(error.status, error.code, error.message);
    return jsonError(500, "permission_update_failed", "权限保存失败，请检查输入或刷新后重试");
  }
});

// ─── 智能体访问管理 ──────────────────────────────────────────────────

consoleRoutes.get("/agents", async (c) => {
  const gate = await requireStudioAction(c.req.raw, "studio.access");
  if (!gate.ok) return gate.response;
  const rows = await db
    .select({
      id: agentTable.id,
      agentKey: agentTable.agentKey,
      displayName: agentTable.displayName,
      lifecycleState: agentTable.lifecycleState,
      currentRevisionId: agentTable.currentRevisionId,
    })
    .from(agentTable)
    .where(and(eq(agentTable.tenantId, gate.principal.tenantId), isNull(agentTable.deletedAt)));
  return jsonOk({ agents: rows });
});

/**
 * 智能体访问授权门（与源实现一致）：
 * studio.access 基线 + （负责人 或 user.manage 持有者）才可查看/修改使用范围。
 */
async function authorizeAgentAccess(c: Context) {
  const gate = await requireStudioAction(c.req.raw, "studio.access");
  if (!gate.ok) return gate;
  const id = c.req.param("id") ?? "";
  const [agent] = await db
    .select()
    .from(agentTable)
    .where(and(eq(agentTable.tenantId, gate.principal.tenantId), eq(agentTable.id, id)));
  if (!agent || agent.deletedAt)
    return { ok: false as const, response: jsonError(404, "not_found", "智能体不存在") };
  const manages = await checkActionScope(gate.principal.tenantId, gate.principal.userIdentityId, {
    actionCode: "user.manage",
    resource: { type: "tenant", id: gate.principal.tenantId },
  });
  if (agent.ownerUserId !== gate.principal.userIdentityId && !manages.allowed)
    return {
      ok: false as const,
      response: jsonError(403, "permission_denied", "没有管理此智能体使用范围的权限"),
    };
  return { ok: true as const, principal: gate.principal, agent };
}

consoleRoutes.get("/agents/:id/access", async (c) => {
  const gate = await authorizeAgentAccess(c);
  if (!gate.ok) return gate.response;
  const tenantId = gate.principal.tenantId;
  const [policies, principals, groups] = await Promise.all([
    db
      .select()
      .from(resourceAccessPolicy)
      .where(
        and(
          eq(resourceAccessPolicy.tenantId, tenantId),
          or(
            and(
              eq(resourceAccessPolicy.resourceType, "agent"),
              eq(resourceAccessPolicy.resourceId, gate.agent.id),
            ),
            and(
              eq(resourceAccessPolicy.resourceType, "tenant"),
              eq(resourceAccessPolicy.resourceId, tenantId),
            ),
          ),
        ),
      ),
    db
      .select({
        id: principalBinding.id,
        label: principalBinding.displayName,
        type: principalBinding.subjectType,
      })
      .from(principalBinding)
      .where(eq(principalBinding.tenantId, tenantId)),
    db.select().from(permissionGroup).where(eq(permissionGroup.tenantId, tenantId)),
  ]);
  return jsonOk({
    defaultMode: policies.find((p) => p.resourceType === "tenant")?.mode ?? "all",
    policy: policies.find((p) => p.resourceType === "agent") ?? {
      // 缺行 = 未配置 = 继承平台默认（与评测端缺行语义一致；稀疏策略语义，
      // 消费方不再在资源创建时预写 inherit 行）。
      mode: "inherit",
      principals: [],
      collaborators: [],
      version: 0,
    },
    subjects: principals
      .filter((p) => p.type === "user" || groups.some((g) => g.principalId === p.id))
      .map((p) => ({
        id: p.id,
        label: p.label ?? "未命名成员",
        description:
          p.type === "user"
            ? "成员"
            : groups.find((g) => g.principalId === p.id)?.source === "local"
              ? "本地用户组"
              : "企业组织",
      })),
  });
});

consoleRoutes.put("/agents/:id/access", async (c) => {
  const gate = await authorizeAgentAccess(c);
  if (!gate.ok) return gate.response;
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return jsonError(400, "invalid_input", "请求格式无效");
  try {
    return jsonOk(
      await changePermissionManagement(gate.principal.tenantId, gate.principal.userIdentityId, {
        ...body,
        operation: "save_access",
        resourceType: "agent",
        resourceId: gate.agent.id,
      }),
    );
  } catch (error) {
    if (error instanceof PermissionManagementError)
      return jsonError(error.status, error.code, error.message);
    return jsonError(500, "update_failed", "使用范围保存失败");
  }
});
