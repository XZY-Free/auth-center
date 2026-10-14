/**
 * 步骤 1 冒烟：环境加载 + DB 连接 + 移植查询模块可用性（对着本地 dev 库）。
 * 只读为主：tenant 查询 / 用户计数 / ensureDefaultTenant 读路径。
 */
import { loadEnvFiles } from "@/lib/env-loader";

async function main(): Promise<void> {
  loadEnvFiles();

  const { db } = await import("@/lib/db/client");
  const { count } = await import("drizzle-orm");
  const { tenant, userIdentity } = await import("@/lib/persistence/schema/identity");
  const { ensureDefaultTenant } = await import("@/lib/identity/tenant-bootstrap");

  const t = await ensureDefaultTenant();
  console.log(`[smoke] ensureDefaultTenant 读路径 OK：tenant=${t.key} status=${t.status}`);

  const tenants = await db.select().from(tenant).limit(3);
  console.log(`[smoke] tenant 表查询 OK（前 3）: ${tenants.map((r) => r.key).join(", ")}`);

  const [users] = await db.select({ n: count() }).from(userIdentity);
  console.log(`[smoke] userIdentity 计数 OK: ${users?.n ?? "?"}`);

  console.log("[smoke] 全部通过 ✓");
  process.exit(0);
}

void main().catch((err) => {
  console.error("[smoke] 失败:", err);
  process.exit(1);
});
