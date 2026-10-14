import { loadEnvFiles } from "@/lib/env-loader";
/**
 * auth-center API 服务入口（Hono + @hono/node-server）。
 *
 * - 端口：AUTH_CENTER_PORT（默认 3100）。
 * - 开发：只提供 API；门户/管理台由 `pnpm dev:web`（Vite :3101，/api 代理到本服务）。
 * - 生产：伺服 web/dist 静态产物（SPA fallback），API 同源。
 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

async function main(): Promise<void> {
  loadEnvFiles();

  // 延迟加载：确保 env 文件先于配置读取（配置为惰性 getter，此处仍统一延后）。
  const { resolveAppEnv, serverConfig } = await import("@/lib/config");
  const { logger } = await import("@/lib/logger");
  const { authRoutes } = await import("@/server/routes/auth");
  const { consumerRoutes } = await import("@/server/routes/consumer");
  const { consoleRoutes } = await import("@/server/routes/console");

  const app = new Hono();

  app.get("/health", (c) =>
    c.json({ ok: true, service: "auth-center", time: new Date().toISOString() }),
  );

  // 认证路由：/api/auth/{login,sso,callback,setup-password,logout,external-methods}
  app.route("/api/auth", authRoutes);
  // 消费方接口：/api/session/*、/api/permissions/snapshot、/api/authorize、/api/directory/*
  app.route("/api", consumerRoutes);
  // 管理台接口：/api/console/settings/*、/api/console/agents/*
  app.route("/api/console", consoleRoutes);

  if (resolveAppEnv() === "production") {
    // 生产：同源伺服门户与静态资产（构建产物见 web/dist）。
    app.use("/*", serveStatic({ root: "./web/dist" }));
    app.get("*", serveStatic({ path: "./web/dist/index.html" }));
  }

  serve({ fetch: app.fetch, port: serverConfig.port }, (info) => {
    logger.info(`[auth-center] listening on http://127.0.0.1:${info.port}`);
  });
}

void main();
