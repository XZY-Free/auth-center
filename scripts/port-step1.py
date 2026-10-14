#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段② 步骤 1：从 nexharness 移植身份域到 auth-center（代码移植，非 git 搬迁）。

- 直接复制：身份域 31 件 + 评测/协议附件 + 装配支撑 + schema（19 表 + 3 外部引用）
- 改造复制：db/client（env 前缀）、config（精简重写）、utils（摘取）、api-fetch（变量名）
- 新写：env-loader、schema/index、tenant-bootstrap（裁剪版）
运行后请执行 pnpm install → pnpm typecheck。
"""
import os
import shutil

SRC = "/Users/sunshine/IdeaProjects/python-service/snow_harness"
DST = "/Users/sunshine/IdeaProjects/auth-center"

FOUNDATION = [
    "lib/error-codes.ts",
    "lib/http.ts",
    "lib/logger.ts",
    "lib/runtime/secret-redaction.ts",
    "lib/constants.ts",
    "lib/crypto/rfc-8785-canonicalize.ts",
    "lib/db/client.ts",
    "lib/db/mysql-error.ts",
    "lib/db/seed.ts",
    "lib/persistence/schema/json-column.ts",
]
SCHEMAS5 = [
    "lib/persistence/schema/identity.ts",
    "lib/persistence/schema/authorization.ts",
    "lib/persistence/schema/deletion-request.ts",
    "lib/persistence/schema/retention-policy.ts",
    "lib/persistence/schema/security-incident.ts",
]
EXTERNAL3 = [
    "lib/persistence/schema/agents.ts",
    "lib/persistence/schema/audit.ts",
    "lib/persistence/schema/control-plane.ts",
]
IDENTITY_FILES = [
    "resolver",
    "local-authentication",
    "authentication-provider",
    "password-strength",
    "identity-extension",
    "identity-extension-bootstrap",
    "enterprise-profile-source",
    "accept-enterprise-profile-observation",
    "enterprise-user",
    "enterprise-user-profile-queries",
    "prepare-enterprise-user-context",
    "enterprise-user-access-policy",
    "enterprise-permission-groups",
    "principal-binding-queries",
    "user-identity-queries",
    "settings-queries",
    "tenant-queries",
    "deletion-executor",
    "deletion-planner",
    "deletion-request-queries",
    "deletion-store-adapter",
    "deletion-store-config",
    "legal-hold-queries",
    "retention-policy-queries",
    "security-incident-queries",
    "permission-context",
    "permission-management",
    "role-templates",
    "permission-directory",
    "resource-scope",
    "enterprise-authorization",
]
IDENTITY_EXTRA = [
    "lib/identity/audit.ts",
    "lib/identity/audit-queries.ts",
    "lib/identity/action-codes.ts",
    "lib/identity/service-identity.ts",
    "lib/identity/authorization.ts",
    "lib/identity/workload-token.ts",
]
PLUMBING = [
    "lib/deployment/identity-extension.ts",
    "lib/studio/admin-audit.ts",
]

MARKER = """/* ─────────────────────────────────────────────────────────
 * 外部引用表 · 属 nexharness 侧 schema（auth-center 只读写引用，
 * 不参与本仓迁移生成；结构变更由 nexharness 主导，只加不删）。
 * ───────────────────────────────────────────────────────── */
"""

TENANT_BOOTSTRAP = '''/**
 * Tenant（auth-center 侧）。
 *
 * 移植自 nexharness `lib/identity/tenant-bootstrap.ts` 的租户供给片段（2026-10-14 阶段②）。
 * - 本仓只负责租户行（身份域）；Governance/Policy 内核基线的供给由 nexharness 负责，
 *   两侧衔接方式为阶段②开放点（docs/split 施工图 v4 §四）。
 * - 铁律（沿用）：不允许"有 Tenant 但无 Governance / Policy"——该不变量待内核
 *   供给流接线完成后由两侧共同保证。
 */
import { db } from "@/lib/db/client";
import { isMysqlDuplicateEntryError } from "@/lib/db/mysql-error";
import { tenant } from "@/lib/persistence/schema/identity";
import { eq } from "drizzle-orm";

/** 默认租户 key（单租户阶段固定）。 */
export const DEFAULT_TENANT_KEY = "default";
export const DEFAULT_TENANT_NAME = "Default Tenant";
/** 默认租户 id 固定，便于单租户部署和测试复用。 */
export const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000000";

/**
 * 幂等确保默认租户存在（本仓只写租户行；内核基线由 nexharness 供给流负责）。
 * - 已存在：直接返回。
 * - 不存在：插入（并发竞争由 duplicate key 兜底，语义与移植前一致）。
 */
export async function ensureDefaultTenant(): Promise<{
  id: string;
  key: string;
  name: string;
  status: string;
}> {
  const [existing] = await db
    .select({ id: tenant.id, key: tenant.key, name: tenant.name, status: tenant.status })
    .from(tenant)
    .where(eq(tenant.key, DEFAULT_TENANT_KEY))
    .limit(1);
  if (existing) return existing;

  try {
    await db.transaction(async (tx) => {
      // 并发兜底：事务内再查一次，已存在则跳过。
      const [row] = await tx
        .select({ id: tenant.id })
        .from(tenant)
        .where(eq(tenant.key, DEFAULT_TENANT_KEY))
        .limit(1);
      if (row) return;
      await tx.insert(tenant).values({
        id: DEFAULT_TENANT_ID,
        key: DEFAULT_TENANT_KEY,
        name: DEFAULT_TENANT_NAME,
        status: "active",
      });
    });
  } catch (err) {
    // 并发竞争：另一事务已先创建租户（duplicate key）。仅吞掉重复键，其余继续抛出。
    if (!isMysqlDuplicateEntryError(err)) throw err;
  }

  const [created] = await db
    .select({ id: tenant.id, key: tenant.key, name: tenant.name, status: tenant.status })
    .from(tenant)
    .where(eq(tenant.key, DEFAULT_TENANT_KEY))
    .limit(1);
  if (!created) throw new Error("无法创建默认租户");
  return created;
}
'''

SCHEMA_INDEX = '''/**
 * auth-center schema 入口（应用查询用）。
 *
 * 迁移生成的入口只包含本仓 19 表——见 drizzle.config.ts；
 * 本文件额外导出外部引用表（agents / audit / control-plane，属 nexharness）。
 */
export * from "./identity";
export * from "./authorization";
export * from "./deletion-request";
export * from "./retention-policy";
export * from "./security-incident";

// ── 外部引用表（属 nexharness；本仓读写引用、不迁移）──
export * from "./agents";
export * from "./audit";
export * from "./control-plane";
'''

PORTING_NOTES = '''# PORTING-NOTES —— 阶段② 步骤 1：nexharness → auth-center 移植记录

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
'''


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def copy_file(rel: str) -> None:
    src = os.path.join(SRC, rel)
    dst = os.path.join(DST, rel)
    assert os.path.exists(src), f"源文件缺失: {rel}"
    ensure_dir(os.path.dirname(dst))
    shutil.copy2(src, dst)
    return None


def main() -> None:
    count = 0
    for rel in FOUNDATION + SCHEMAS5 + EXTERNAL3 + PLUMBING:
        copy_file(rel)
        count += 1
    for name in IDENTITY_FILES:
        copy_file(f"lib/identity/{name}.ts")
        count += 1
    for rel in IDENTITY_EXTRA:
        copy_file(rel)
        count += 1

    # 外部引用 schema：加标记头
    for rel in EXTERNAL3:
        p = os.path.join(DST, rel)
        s = open(p, encoding="utf-8").read()
        if "外部引用表" not in s[:200]:
            open(p, "w", encoding="utf-8").write(MARKER + s)

    # client.ts env 适配
    p = os.path.join(DST, "lib/db/client.ts")
    s = open(p, encoding="utf-8").read()
    s = s.replace("NEX_DB_CONNECTION_LIMIT", "AUTH_CENTER_DB_CONNECTION_LIMIT")
    s = s.replace("NEX_DB_QUEUE_LIMIT", "AUTH_CENTER_DB_QUEUE_LIMIT")
    s = s.replace("__nexMysqlPool", "__authCenterMysqlPool")
    s = s.replace("避免 Next.js 开发模式热重载反复建池", "避免 tsx watch 热重载反复建池")
    open(p, "w", encoding="utf-8").write(s)

    # 新写文件
    open(os.path.join(DST, "lib/identity/tenant-bootstrap.ts"), "w", encoding="utf-8").write(
        TENANT_BOOTSTRAP
    )
    open(os.path.join(DST, "lib/persistence/schema/index.ts"), "w", encoding="utf-8").write(
        SCHEMA_INDEX
    )
    open(os.path.join(DST, "PORTING-NOTES.md"), "w", encoding="utf-8").write(PORTING_NOTES)

    print(f"✓ 复制 {count} 个源文件 + 3 个新写文件")

    # 残留 NEX_ 检索（身份文件里可能残留 env 引用）
    hits = []
    for root, _dirs, files in os.walk(os.path.join(DST, "lib")):
        for fn in files:
            if not fn.endswith(".ts"):
                continue
            fp = os.path.join(root, fn)
            s = open(fp, encoding="utf-8").read()
            if "NEX_" in s:
                for ln, line in enumerate(s.split("\n"), 1):
                    if "NEX_" in line:
                        hits.append(f"{os.path.relpath(fp, DST)}:{ln}: {line.strip()[:100]}")
    print(f"残留 NEX_ 引用 {len(hits)} 处：")
    for h in hits[:20]:
        print("  ", h)


if __name__ == "__main__":
    main()
