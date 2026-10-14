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

## 门户 UI（步骤 1 第三轮，2026-10-14）

**结构**：组件置于仓库根 `components/`（与 nexharness 同构，`@/components/*` 零改导入）。

| 文件/目录 | 内容 |
|---|---|
| components/ui/{button,input,label}.tsx | 从 nexharness 复制（@base-ui/react 原语；依赖新增 `@base-ui/react@^1.6.0`） |
| components/auth/*（5 件） | 登录屏 / 表单 / 外部认证区 / 设密屏 / 布局：复制 + 去 `"use client"` + 登录响应优先 `redirect_to`（票据回跳） |
| components/brand/{brand-provider,brand-wordmark}.tsx | wordmark 复制；provider **简化为静态品牌**（DEFAULT_BRAND）——不引入 nexharness 的品牌存储与 SSE 热更新 |
| lib/branding/{brand-contract,brand-presentation}.ts | 复制（零副作用纯函数） |
| web/src/pages/{login,setup-password,home}-page.tsx | react-router 页面：登录页（会话探测 → 自动续跳 `/api/auth/ticket`；否则渲染表单） |
| web/src/styles.css | 语义 token 体系从 nexharness `app/globals.css` 提取（:root/.dark/@theme inline/@layer base）；`@source` 显式声明根级 `components/` 扫描范围 |
| scripts/port-portal.py | 本轮移植脚本（记录用） |

**新增服务端点（配合门户）**：
- `GET /api/auth/password-enrollment`：设密会话查询（设密页渲染用；无会话 401）。
- `GET /api/auth/ticket?returnTo=`：已登录会话的"回跳续期"——外部地址签发**新一次性票据** 302，站内相对路径直接 302；未登录 302 回登录页（客户端再确认）。

**坑（已修复）**：
- vite 代理默认把 Host 改写为上游地址 → API 侧 `publicOrigin` 用内部 Host 拼出 `http://127.0.0.1:3100/...` 的跳转。修复：代理显式转发原始 Host（`changeOrigin: false` + `x-forwarded-host`），与生产 nginx 语义一致。
- Tailwind v4 自动源扫描不覆盖 `web/` 之外的 `components/` → 组件类不生成（布局崩坏）。修复：`@source "../../components/**/*.{ts,tsx}"`。

**验证**：typecheck ✓ lint ✓ build ✓；浏览器全链路冒烟 9/9（真实 Chromium：匿名→表单→登录→消费者回跳携带票据→服务端兑换→会话续跳新票据→门户首页）。

## 管理台（步骤 1 第四轮，2026-10-14）

**结构**：控制台组件置于根 `components/studio/`、UI 基础件扩至 `components/ui/`。

| 文件/目录 | 内容 |
|---|---|
| lib/identity/studio-access.ts | 守卫适配层（requireStudioAction / hasStudioAction / hasStudioActionInAnyScope），零改复制 |
| components/ui/{checkbox,dialog,select,tabs}.tsx | 复制（@base-ui/react 原语；依赖新增 devDeps `tw-animate-css`、`shadcn`，styles.css 增两条 `@import`） |
| components/studio/{permission-manager,permission-subject-picker,agent-access-manager}.tsx | 复制 + 去 "use client" + 接口前缀 `/studio/api/...` → `/api/console/...`（组件仅改 URL 常量） |
| components/studio/{studio-page,studio-settings-section,gate-page,appearance-setting}.tsx | 复制；gate-page / settings-section 的 next/link → react-router Link |
| server/routes/console.ts（新写） | 管理台 API（Hono）：settings/users、settings/users/:id/roles、settings/permissions（GET/POST/explain）、agents 列表、agents/:id/access（GET/PUT）；**沿用 `{ok,data}` 信封**（jsonOk/jsonError）与组件消费方式一致 |
| web/src/pages/console/*（新写） | 控制台壳（顶栏导航）+ 设置页 + 智能体列表页 + 单智能体访问页；守卫：401→登录页、403→GatePage |
| web/index.html | 新增主题初始化内联脚本（nex-theme 约定，防暗色闪白） |

**适配说明**：
- 原 Next 服务端页级守卫（requireStudioPagePermission）→ SPA 客户端取数 + 接口侧守卫（服务端才是权威）。
- 智能体访问入口：源为 studio 内嵌（路径带 agent id）→ auth-center 控制台新增 `GET /api/console/agents` 列表页做入口。
- 治理面（deletion/retention/legal-hold/incident）为纯 API（无 UI），随步骤 2 主体一并接线。

**验证**：typecheck ✓ lint ✓ build ✓；管理台浏览器冒烟 10/10（真实 Chromium：登录回跳 → 设置页渲染（成员/角色/外观）→ 智能体列表 → 访问设置选择并保存成功 → 匿名接口 401）。冒烟用测试智能体 `console-smoke-agent`（dev 库，可删）。

## 后续步骤（阶段②）

1. ~~路由移植~~ ✅ 已完成（2026-10-14，冒烟 29/29）。
2. ~~门户 UI（登录/设密/首页）~~ ✅ 已完成（2026-10-14，浏览器冒烟 9/9）。
3. ~~管理台（成员与权限 + 智能体访问）~~ ✅ 已完成（2026-10-14，浏览器冒烟 10/10）。
4. **nexharness 侧消费化改造**（步骤 2 主体：identity-client + 读路径收敛）；治理 API 接线随行。
