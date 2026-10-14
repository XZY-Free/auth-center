/**
 * 权限快照构建器（消费方接口 `GET /api/permissions/snapshot` 的数据源）。
 *
 * 设计（见 docs/split 施工图 v4"消费方模型"）：
 * - auth-center 是唯一评测权威；快照把 loadPermissionContext 的**展开结果**
 *   序列化为可缓存的稳定结构（grant 已展开、来源已标注）。
 * - 消费方（nexharness）缓存快照（建议 5~15min）并做**清单匹配**；
 *   变更/敏感操作实时调用 `POST /api/authorize`。
 * - 企业授权（私有发行版）在 auth-center 侧完成求值，快照携带按 agent
 *   目录求值的结果；开源默认（无 provider）为 null。
 *
 * 快照不含身份凭证、不含明文密码；digest 覆盖全部事实字段，供消费方
 * 做缓存一致性判断（同 digest 可跳过刷新）。
 */
import { type PermissionContext, loadPermissionContext } from "@/lib/identity/permission-context";
import type { ResourceScope } from "@/lib/identity/resource-scope";

export interface SnapshotGrant {
  readonly actionCode: string;
  readonly resourceScope: ResourceScope;
  readonly source: string;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
}

export interface SnapshotPolicy {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly mode: string;
  readonly principals: unknown;
  readonly collaborators: unknown;
  readonly version: number;
}

export interface SnapshotAgent {
  readonly id: string;
  readonly ownerUserId: string;
  readonly lifecycleState: string;
  readonly currentRevisionId: string | null;
  readonly deleted: boolean;
}

export interface SnapshotEnterprise {
  readonly agentIds: "all" | readonly string[];
  readonly decisions: Readonly<Record<string, { allowed: boolean; reason?: string }>>;
}

export interface PermissionSnapshot {
  /** 事实摘要（sha256）；消费方用其判断缓存是否仍新鲜。 */
  readonly digest: string;
  readonly generatedAt: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly active: boolean;
  readonly principalIds: readonly string[];
  readonly grants: readonly SnapshotGrant[];
  readonly policies: readonly SnapshotPolicy[];
  readonly agents: readonly SnapshotAgent[];
  readonly enterprise: SnapshotEnterprise | null;
}

function serializeSnapshot(
  tenantId: string,
  userId: string,
  context: PermissionContext,
): PermissionSnapshot {
  return {
    digest: context.digest,
    generatedAt: new Date().toISOString(),
    tenantId,
    userId,
    active: context.active,
    principalIds: [...context.principalIds].sort(),
    grants: context.grants.map((grant) => ({
      actionCode: grant.actionCode,
      resourceScope: grant.resourceScope,
      source: grant.source,
      validFrom: grant.validFrom ?? null,
      validUntil: grant.validUntil ?? null,
    })),
    policies: context.policies.map((policy) => ({
      resourceType: policy.resourceType,
      resourceId: policy.resourceId,
      mode: policy.mode,
      principals: policy.principals,
      collaborators: policy.collaborators,
      version: policy.version,
    })),
    agents: context.agents.map((agent) => ({
      id: agent.id,
      ownerUserId: agent.ownerUserId,
      lifecycleState: agent.lifecycleState,
      currentRevisionId: agent.currentRevisionId,
      deleted: agent.deletedAt !== null,
    })),
    enterprise: context.enterprise
      ? {
          agentIds: context.enterprise.agentIds,
          decisions: context.enterprise.decisions,
        }
      : null,
  };
}

/**
 * 构建权限快照。
 *
 * `agent_catalog` 求值模式：对租户全部 agent 预求值 `agent.invoke`
 * （含企业授权），让消费方对 agent 使用范围可完全本地判断。
 */
export async function buildPermissionSnapshot(
  tenantId: string,
  userId: string,
): Promise<PermissionSnapshot> {
  const context = await loadPermissionContext(tenantId, userId, undefined, "agent_catalog");
  return serializeSnapshot(tenantId, userId, context);
}
