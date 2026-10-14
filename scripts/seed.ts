/**
 * 正式 schema seed CLI（空库流程：Migration → Seed）。
 *
 * 用法：pnpm db:seed（读取 .env.{APP_ENV} 的 DATABASE_URL）。
 * 注意：db client / 身份模块必须动态 import——静态 import 会在 loadEnvFiles()
 * 之前执行，导致连接池读取空 DATABASE_URL（与 server/index.ts 的延迟加载同因）。
 */
import { loadEnvFiles } from "@/lib/env-loader";

async function main(): Promise<void> {
  loadEnvFiles();
  const { ensureDefaultTenant } = await import("@/lib/identity/tenant-queries");
  const { closeDbPool } = await import("@/lib/db/client");
  try {
    console.log("[seed] 开始正式 schema seed...");
    const tenant = await ensureDefaultTenant();
    console.log(`[seed] 默认租户就绪：tenant=${tenant.id}`);
    // 不创建默认 Agent（Agent 空表合法）；用户与权限由 auth:bootstrap-admin 显式创建。
    console.log("[seed] 正式 schema seed 完成（未创建默认用户）");
  } finally {
    await closeDbPool();
  }
}

main().catch((error) => {
  console.error("[seed] 失败：", error);
  process.exit(1);
});
