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
 *
 * 代理必须保留浏览器可见的 Host（x-forwarded-host），否则 API 侧用
 * 内部 Host 拼出的跳转地址会把用户带回 127.0.0.1:3100——与生产 nginx
 * `proxy_set_header X-Forwarded-Host $host` 的语义保持一致。
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
      "/api": {
        target: "http://127.0.0.1:3100",
        changeOrigin: false,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq, req) => {
            const host = req.headers.host;
            if (host) {
              proxyReq.setHeader("host", host);
              proxyReq.setHeader("x-forwarded-host", host);
            }
            proxyReq.setHeader("x-forwarded-proto", "http");
          });
        },
      },
    },
  },
  build: {
    outDir: resolve(webRoot, "dist"),
    emptyOutDir: true,
  },
});
