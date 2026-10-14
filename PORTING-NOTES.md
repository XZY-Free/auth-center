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

## 后续步骤（阶段②）

1. 路由移植：`/api/auth` 6 操作（login/logout/sso/callback/setup-password/external-methods）+
   消费方接口集（session introspect / resolve / revoke、permissions snapshot、authorize、directory）。
2. 门户/管理台 UI 移植（web/：react-router + 组件逐件）。
3. 冒烟：登录全链路 + 管理台 + 治理入口。
