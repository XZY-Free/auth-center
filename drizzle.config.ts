/**
 * drizzle-kit 配置。
 *
 * schema 只列 auth-center 自有的 19 张表（身份域 13 + 合规 6）——迁移产物归本仓；
 * 外部引用表（agents / audit / control-plane，属 nexharness）不参与本仓迁移生成。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

// 轻量 env 加载（drizzle-kit 不自动读 .env；与 lib/env-loader.ts 同优先级语义）。
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
const appEnv = process.env.APP_ENV || process.env.NODE_ENV || "development";
loadEnvFile(resolve(process.cwd(), `.env.${appEnv}`));
loadEnvFile(resolve(process.cwd(), `.env.${appEnv}.local`));

export default defineConfig({
  schema: [
    "./lib/persistence/schema/identity.ts",
    "./lib/persistence/schema/authorization.ts",
    "./lib/persistence/schema/deletion-request.ts",
    "./lib/persistence/schema/retention-policy.ts",
    "./lib/persistence/schema/security-incident.ts",
  ],
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
