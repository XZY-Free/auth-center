/**
 * Tenant（auth-center 侧）。
 *
 * 移植自 nexharness `lib/identity/tenant-bootstrap.ts` 的租户供给片段（2026-10-14 阶段②）。
 * - 本仓只负责租户行（身份域）；Governance/Policy 内核基线的供给由 nexharness 负责，
 *   两侧衔接方式为阶段②开放点（docs/split 施工图 v4 §四）。
 * - 铁律（沿用）：不允许"有 Tenant 但无 Governance / Policy"——该不变量待内核
 *   供给流接线完成后由两侧共同保证。
 */
import { db } from "@/lib/db/client";
import { isMysqlDuplicateEntryError } from "@/lib/db/mysql-error";
import { tenant } from "@/lib/persistence/schema/identity";
import { eq } from "drizzle-orm";

/** 默认租户 key（单租户阶段固定）。 */
export const DEFAULT_TENANT_KEY = "default";
export const DEFAULT_TENANT_NAME = "Default Tenant";
/** 默认租户 id 固定，便于单租户部署和测试复用。 */
export const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000000";

/**
 * 幂等确保默认租户存在（本仓只写租户行；内核基线由 nexharness 供给流负责）。
 * - 已存在：直接返回。
 * - 不存在：插入（并发竞争由 duplicate key 兜底，语义与移植前一致）。
 */
export async function ensureDefaultTenant(): Promise<{
  id: string;
  key: string;
  name: string;
  status: string;
}> {
  const [existing] = await db
    .select({ id: tenant.id, key: tenant.key, name: tenant.name, status: tenant.status })
    .from(tenant)
    .where(eq(tenant.key, DEFAULT_TENANT_KEY))
    .limit(1);
  if (existing) return existing;

  try {
    await db.transaction(async (tx) => {
      // 并发兜底：事务内再查一次，已存在则跳过。
      const [row] = await tx
        .select({ id: tenant.id })
        .from(tenant)
        .where(eq(tenant.key, DEFAULT_TENANT_KEY))
        .limit(1);
      if (row) return;
      await tx.insert(tenant).values({
        id: DEFAULT_TENANT_ID,
        key: DEFAULT_TENANT_KEY,
        name: DEFAULT_TENANT_NAME,
        status: "active",
      });
    });
  } catch (err) {
    // 并发竞争：另一事务已先创建租户（duplicate key）。仅吞掉重复键，其余继续抛出。
    if (!isMysqlDuplicateEntryError(err)) throw err;
  }

  const [created] = await db
    .select({ id: tenant.id, key: tenant.key, name: tenant.name, status: tenant.status })
    .from(tenant)
    .where(eq(tenant.key, DEFAULT_TENANT_KEY))
    .limit(1);
  if (!created) throw new Error("无法创建默认租户");
  return created;
}
