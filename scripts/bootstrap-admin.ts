/**
 * 本地/开发环境管理员引导。
 *
 * 身份域的建号动作归 auth-center（用户身份 / 登录凭证 / 主体绑定 / 角色分配
 * 为权威数据）；能力工具的注册归 nexharness（其 scripts/register-builtin-tools.ts）。
 *
 * 用法（与既有 dev 环境约定一致的 env 变量）：
 *   NEX_BOOTSTRAP_ADMIN_EMAIL=admin@nexharness.local \
 *   NEX_BOOTSTRAP_ADMIN_NAME="本地管理员" \
 *   NEX_BOOTSTRAP_ADMIN_PASSWORD_FILE=~/.config/nexharness/dev-admin-password.txt \
 *   pnpm auth:bootstrap-admin
 *
 * 注意：db client / 身份模块必须动态 import——静态 import 会在 loadEnvFiles()
 * 之前执行，导致连接池读取空 DATABASE_URL（与 server/index.ts 的延迟加载同因）。
 */
import { readFileSync, statSync } from "node:fs";
import { loadEnvFiles } from "@/lib/env-loader";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

async function main(): Promise<void> {
  loadEnvFiles();
  const email = required("NEX_BOOTSTRAP_ADMIN_EMAIL");
  const displayName = required("NEX_BOOTSTRAP_ADMIN_NAME");
  const passwordFile = required("NEX_BOOTSTRAP_ADMIN_PASSWORD_FILE");
  const mode = statSync(passwordFile).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error("管理员密码文件权限过宽，请设置为仅文件所有者可读写（0600）");
  }
  const password = readFileSync(passwordFile, "utf8").replace(/[\r\n]+$/, "");
  const { bootstrapLocalAdmin } = await import("@/lib/identity/local-authentication");
  const identity = await bootstrapLocalAdmin({ email, displayName, password });
  console.log(
    `[auth] 管理员账号已初始化：${email.trim().toLowerCase()}（tenant=${identity.tenantId}）`,
  );
}

main()
  .catch((error) => {
    console.error("[auth] 管理员初始化失败：", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { closeDbPool } = await import("@/lib/db/client");
    await closeDbPool();
  });
