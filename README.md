# auth-center

NexHarness 统一身份中心：登录 / 会话 / 用户目录 / 角色与授权 / 生命周期治理。

- **技术栈**：Hono（API 服务，`server/`）+ Vite + React（登录门户与管理台，`web/`）+ MySQL / Drizzle ORM。
- **职责**：身份与授权数据的**唯一权威**（19 表 = 身份域 13 + 合规 6）；向 nexharness 与各业务系统提供统一登录与消费方接口（会话校验 / 权限快照 / 实时授权 / 目录读；见 `docs/split` 施工图 v4）。
- **状态**：阶段② 步骤 1（骨架 + 身份域移植 + 19 表迁移）；路由与门户移植进行中。

## 快速开始

```bash
pnpm install

# 开发：双进程（API :3100 + 门户 :3101，/api 代理到 3100）
pnpm dev

# 单独启动
pnpm dev:server      # Hono API（tsx watch）
pnpm dev:web         # Vite 门户 dev server

# 质量
pnpm typecheck && pnpm lint && pnpm build

# 数据库（19 表）
pnpm db:generate     # 生成迁移（drizzle/）
pnpm db:migrate      # 应用迁移（读取 .env.{APP_ENV} 的 DATABASE_URL）
pnpm db:seed         # 默认租户 + 默认身份（幂等）
```

环境变量：见 `.env.example`；本地覆盖写 `.env.development.local`（git 忽略）。

## 结构

- `server/` —— Hono API 入口（阶段②逐步挂载 /api/auth、/api/session、/api/permissions、/api/authorize、/api/directory）
- `lib/` —— 身份域与支撑模块（移植自 nexharness，改动记录见 `PORTING-NOTES.md`）
- `web/` —— 登录门户 + 管理台（Vite + React + Tailwind 4）
- `drizzle/` —— 本仓 19 表迁移；外部引用表（agents / audit / control-plane）不参与本仓迁移
- `scripts/` —— dev 编排、移植脚本、冒烟脚本
