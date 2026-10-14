/**
 * auth-center 环境文件加载（零依赖、显式优先级）。
 *
 * 优先级（高 → 低）：
 *   1. 已存在的进程环境变量（平台注入 / 命令行）
 *   2. .env.{APP_ENV}.local（个人覆盖，git 忽略）
 *   3. .env.{APP_ENV}（非敏感默认，提交 git）
 *
 * 实现：先从低优先级文件加载，已存在的键不覆盖——等价于"高层级先到先得"。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** 按 APP_ENV 加载 .env 文件（不覆盖已存在的进程环境变量）。 */
export function loadEnvFiles(cwd: string = process.cwd()): void {
  const appEnv = process.env.APP_ENV || process.env.NODE_ENV || "development";
  const candidates = [resolve(cwd, `.env.${appEnv}`), resolve(cwd, `.env.${appEnv}.local`)];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const parsed = parseEnvFile(file);
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
