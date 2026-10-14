# auth-center 容器镜像（Hono API + 同源门户/管理台 SPA 单镜像）。
#
# 本地构建（context = 本目录）：
#   docker build -t auth-center:dev .
#
# 本地试跑（示例）：
#   docker run --rm -p 3100:3100 \
#     -e APP_ENV=production \
#     -e DATABASE_URL="mysql://user:pass@host:3306/nexharness" \
#     -e AUTH_CENTER_ALLOWED_ORIGINS="https://ai-uat.crb.cn" \
#     auth-center:dev
#
# 生产形态：单容器 = Hono API（/health、/api/*）+ 门户/管理台 SPA（web/dist，SPA fallback）。
# 运行时环境变量由部署平台注入（DATABASE_URL / AUTH_CENTER_ALLOWED_ORIGINS / AUTH_CENTER_PORT
# 等），启动自检 fail-fast。数据库迁移（pnpm db:migrate）应在部署流水线以一次性任务执行
# （本镜像运行时依赖为仅生产依赖，不含 drizzle-kit）。

# ---------- Stage 1: 全量依赖（web 构建需要 vite 等 devDependencies）----------
FROM node:24-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------- Stage 2: web 静态产物（vite build → web/dist）----------
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build:web

# ---------- Stage 3: 生产依赖 ----------
FROM node:24-alpine AS prod-deps
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# ---------- Stage 4: 运行时 ----------
FROM node:24-alpine AS runner
# tini 作 PID 1 收割子进程；tsx 以 TS 直跑 server（与本地 `pnpm start` 一致——
# tsx 为 devDependency，生产依赖安装不含它，故在运行时单独装全局，版本对齐 devDeps）。
RUN apk add --no-cache tini \
  && npm install --global tsx@4.22.4 \
  && npm cache clean --force
WORKDIR /app
ENV NODE_ENV=production
ENV APP_ENV=production

# tsx 解析 `@/` 路径别名依赖 tsconfig.json（paths）。
COPY package.json tsconfig.json drizzle.config.ts ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY server ./server
COPY lib ./lib
# 迁移文件随镜像分发（供一次性任务容器使用；迁移执行需含 drizzle-kit 的环境）。
COPY drizzle ./drizzle
# 门户/管理台静态产物（生产模式由 server/index.ts 伺服，SPA fallback）。
COPY --from=builder /app/web/dist ./web/dist

EXPOSE 3100
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["tsx", "server/index.ts"]
