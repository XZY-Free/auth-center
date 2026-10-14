/**
 * auth-center 配置（精简自 nexharness `lib/config.ts` 的 env / dbConfig 片段）。
 *
 * 设计原则沿用：零副作用、惰性 getter（缺失返回空串/默认，fail-fast 由启动自检负责）。
 */
export type AppEnv = "development" | "test" | "production";

const ENV_ALIASES: Record<string, AppEnv> = {
  dev: "development",
  prod: "production",
};

export function resolveAppEnv(): AppEnv {
  const raw = process.env.APP_ENV || process.env.NODE_ENV || "development";
  const normalized = ENV_ALIASES[raw] ?? raw;
  if (normalized === "development" || normalized === "test" || normalized === "production") {
    return normalized;
  }
  throw new Error(`[config] 非法 APP_ENV: ${raw}`);
}

export const dbConfig = {
  /** MySQL 连接串。缺失时返回空串——由启动自检 fail-fast。 */
  get url(): string {
    return process.env.DATABASE_URL ?? "";
  },
} as const;

export const serverConfig = {
  /** API 服务端口（默认 3100）。 */
  get port(): number {
    return Number.parseInt(process.env.AUTH_CENTER_PORT ?? "3100", 10);
  },
} as const;

export const consumerConfig = {
  /**
   * 允许的回跳/来源地址名单（逗号分隔）。
   * 每一项是 http(s) origin（如 `http://localhost:3000`）或自定义 scheme
   * （如桌面深链 `nexharness:`）。用于：
   * - 登录回跳目标校验（returnTo 防开放重定向）；
   * - 认证接口的同源放行（开发期反向代理 host 差异）。
   */
  get allowedOrigins(): ReadonlySet<string> {
    return new Set(
      (process.env.AUTH_CENTER_ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
  },
} as const;
