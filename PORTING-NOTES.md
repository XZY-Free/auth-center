# PORTING-NOTES —— 阶段② 步骤 1：nexharness → auth-center 移植记录

- 日期：2026-10-14；源仓：nexharness（原 snow_harness）；方式：**代码移植（全新历史，非 git 搬迁）**。
- `@/*` 路径别名两仓一致 → 绝大多数文件**零 import 修改**直接移植。

## 直接移植（逐字节复制）

- 身份域 31 件：resolver / local-authentication / authentication-provider / password-strength /
  identity-extension(+bootstrap) / enterprise-*（8 件）/ principal-binding-queries / user-identity-queries /
  settings-queries / tenant-queries / 治理 8 件 / permission-context / permission-management /
  role-templates / permission-directory / resource-scope / enterprise-authorization
- 评测/协议附件：action-codes / service-identity / authorization / workload-token / audit / audit-queries
- 装配与支撑：lib/deployment/identity-extension / lib/studio/admin-audit / lib/db/seed /
  lib/constants / lib/error-codes / lib/http / lib/logger / lib/runtime/secret-redaction /
  lib/crypto/rfc-8785-canonicalize / lib/db/mysql-error
- schema（19 表迁移源）：identity / authorization / deletion-request / retention-policy / security-incident
- schema（外部引用，不迁移）：agents / audit / control-plane

## 改造移植（有修改）

| 文件 | 修改 |
|---|---|
| lib/db/client.ts | env 前缀 NEX_DB_* → AUTH_CENTER_DB_*；连接池全局键改名；注释去 Next.js 化 |
| lib/config.ts | 重写为精简版（dbConfig + serverConfig + resolveAppEnv） |
| lib/env-loader.ts | 新写（零依赖 env 加载；优先级：进程 env > .local > 基础文件） |
| lib/utils.ts | 摘取 cn / generateUUID（去掉 ai 依赖） |
| lib/api-fetch.ts | basePath 变量改 AUTH_CENTER_PUBLIC_BASE_PATH |
| lib/identity/tenant-bootstrap.ts | 裁剪：仅保留租户行供给（内核 Governance/Policy 基线由 nexharness 供给流负责——阶段②开放点） |
| lib/persistence/schema/index.ts | 新写（19 表 + 外部引用；迁移入口见 drizzle.config.ts 只含 19 表） |
| lib/identity/local-authentication.ts | 导出 hashSessionToken（session-facts 复用同一 token_hash 口径） |

## 路由层（步骤 1 第二轮，2026-10-14）

**新写（Hono，等价重写自 nexharness Next.js 路由）**：

| 文件 | 内容 |
|---|---|
| server/routes/auth.ts | 6 认证操作（逻辑照搬，适配 Hono；无 basePath；returnTo 改"相对路径 / 允许名单外部地址"双语义；外部回跳签发一次性 ticket） |
| server/routes/consumer.ts | 消费方接口集：session resolve/introspect/revoke、permissions snapshot、authorize、directory 单读/批量 |
| server/lib/http-kit.ts | 共享工具：cookie 序列化（Path=/）、同源校验（允许名单）、Bearer/cookie 凭证归一、returnTo 解析、ticket 附加 |
| server/lib/tickets.ts | 一次性票据内存存储（TTL 60s，单实例；多副本前换共享存储） |
| lib/identity/session-facts.ts | auth_session 最小事实访问（readLiveSession / revokeByToken） |
| lib/identity/permission-snapshot.ts | 权限快照构建（消费方缓存 + 本地清单匹配用；含企业求值） |
| scripts/smoke-api.ts | 接口冒烟：29 项断言（登录→ticket→resolve→introspect→snapshot→authorize→directory→revoke 即时失效） |

**关键适配点**：
- returnTo 语义：站内相对路径（门户页面）或允许名单外部地址（`AUTH_CENTER_ALLOWED_ORIGINS`，含自定义 scheme 如 `nexharness:`）；外部回跳 = 登录完成后 302/响应携带 `?ticket=`。
- 票据流：`issueTicket → consumeTicket` 一次性；消费方服务端 `POST /api/session/resolve` 换取 `{ principal, snapshot, sessionToken, expiresAt }`。
- **坑（已避开）**：`@hono/node-server` 会把全局 `Response` 替换为自身包装类（`_Response`），对原生实例做 `instanceof Response` 恒为 false → 路由层禁止用 `instanceof Response` 判型（改用异常路径）。
- 生产模式伺服 web/dist（SPA fallback）；开发模式只有 API（门户走 vite :3101 代理）。

## 后续步骤（阶段②）

1. ~~路由移植~~ ✅ 已完成（2026-10-14，冒烟 29/29）。
2. 门户/管理台 UI 移植（web/：react-router + 组件逐件）。
3. 冒烟：登录全链路（浏览器） + 管理台 + 治理入口。
