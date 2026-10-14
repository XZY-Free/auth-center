#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
管理台移植脚本（阶段②步骤1 第四轮）：
从 nexharness 复制控制台资产到 auth-center，执行定点适配。

- 组件（ui/studio）保留 `@/components/...` 路径 → auth-center 同构布局（根级 components/）。
- 适配点：
  1. 去 "use client"（Vite 不需要）。
  2. next/link → react-router-dom Link（gate-page / studio-settings-section）。
  3. 接口路径：/studio/api/... → /api/console/...（管理台 API 挂载前缀）。
"""
import os

SRC = os.path.expanduser("~/IdeaProjects/python-service/snow_harness")
DST = os.path.expanduser("~/IdeaProjects/auth-center")

COPY_FILES = [
    # 守卫（评测链复用）
    ("lib/identity/studio-access.ts", "lib/identity/studio-access.ts"),
    # UI 基础件
    ("components/ui/checkbox.tsx", "components/ui/checkbox.tsx"),
    ("components/ui/dialog.tsx", "components/ui/dialog.tsx"),
    ("components/ui/select.tsx", "components/ui/select.tsx"),
    ("components/ui/tabs.tsx", "components/ui/tabs.tsx"),
    # 控制台组件
    ("components/studio/permission-manager.tsx", "components/studio/permission-manager.tsx"),
    (
        "components/studio/permission-subject-picker.tsx",
        "components/studio/permission-subject-picker.tsx",
    ),
    ("components/studio/agent-access-manager.tsx", "components/studio/agent-access-manager.tsx"),
    ("components/studio/studio-page.tsx", "components/studio/studio-page.tsx"),
    (
        "components/studio/studio-settings-section.tsx",
        "components/studio/studio-settings-section.tsx",
    ),
    ("components/studio/gate-page.tsx", "components/studio/gate-page.tsx"),
    ("components/studio/appearance-setting.tsx", "components/studio/appearance-setting.tsx"),
]


def strip_use_client(src: str) -> str:
    if src.startswith('"use client";\n'):
        src = src[len('"use client";\n'):]
        if src.startswith("\n"):
            src = src[1:]
    return src


def adapt_link(src: str) -> str:
    """next/link → react-router Link（href→to）。"""
    old_import = 'import Link from "next/link";'
    assert old_import in src, "next/link import missing"
    src = src.replace(old_import, 'import { Link } from "react-router-dom";', 1)
    src = src.replace("<Link\n      href={href}", "<Link\n      to={href}", 1)
    # gate-page 的固定链接
    src = src.replace('<Link href="/chat"', '<Link to="/"', 1)
    src = src.replace("返回使用端", "返回首页", 1)
    return src


def adapt_urls(src: str) -> str:
    src = src.replace('"/studio/api/settings/permissions"', '"/api/console/settings/permissions"')
    src = src.replace(
        "`/studio/api/agents/${agentId}/access`", "`/api/console/agents/${agentId}/access`"
    )
    return src


def main() -> None:
    for src_rel, dst_rel in COPY_FILES:
        src_path = os.path.join(SRC, src_rel)
        dst_path = os.path.join(DST, dst_rel)
        data = open(src_path, "rb").read().decode("utf-8")

        data = strip_use_client(data)
        if dst_rel.endswith(("gate-page.tsx", "studio-settings-section.tsx")):
            data = adapt_link(data)
        if dst_rel.endswith(("permission-manager.tsx", "agent-access-manager.tsx")):
            data = adapt_urls(data)

        # 安全断言：不应残留 Next.js 专有引用
        assert "next/" not in data, f"{dst_rel} 残留 next/ 引用"
        assert "/studio/api/" not in data, f"{dst_rel} 残留 /studio/api/ 引用"

        os.makedirs(os.path.dirname(dst_path), exist_ok=True)
        open(dst_path, "wb").write(data.encode("utf-8"))
        print(f"✓ {dst_rel}")


if __name__ == "__main__":
    main()
