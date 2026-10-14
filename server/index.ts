import { loadEnvFiles } from "@/lib/env-loader";
/**
 * auth-center API 服务入口（Hono + @hono/node-server）。
 *
 * - 端口：AUTH_CENTER_PORT（默认 3100）。
 * - 阶段②步骤 1：健康检查 + 骨架；路由（auth / session / snapshot / authorize / directory）
 *   随移植逐步挂载（见 docs/split 施工图 v4）。
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";

async function main(): Promise<void> {
  loadEnvFiles();

  // 延迟加载：确保 env 文件先于配置读取（配置为惰性 getter，此处仍统一延后）。
  const { serverConfig } = await import("@/lib/config");
  const { logger } = await import("@/lib/logger");

  const app = new Hono();

  app.get("/health", (c) =>
    c.json({ ok: true, service: "auth-center", time: new Date().toISOString() }),
  );

  // TODO(阶段②)：挂载 /api/auth/*、/api/session/*、/api/permissions/*、/api/authorize、/api/directory/*
  // TODO(阶段②)：生产模式下伺服 web/dist 静态产物

  serve({ fetch: app.fetch, port: serverConfig.port }, (info) => {
    logger.info(`[auth-center] listening on http://127.0.0.1:${info.port}`);
  });
}

void main();
