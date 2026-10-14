import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = process.cwd();
const webRoot = resolve(repoRoot, "web");

/**
 * web（登录门户 + 管理台）构建配置。
 * - dev：3101，/api 代理到 3100（API 服务）。
 * - build：产物在 web/dist，由 Hono 在生产模式伺服。
 */
export default defineConfig({
  root: webRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": repoRoot },
  },
  server: {
    port: 3101,
    proxy: {
      "/api": "http://127.0.0.1:3100",
    },
  },
  build: {
    outDir: resolve(webRoot, "dist"),
    emptyOutDir: true,
  },
});
