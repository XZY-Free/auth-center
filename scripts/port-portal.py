#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
门户移植脚本（阶段②步骤1 第三轮）：
从 nexharness 复制登录门户资产到 auth-center，执行定点适配。

- 组件保留 `@/components/...` 导入路径 → auth-center 采用同布局（根级 components/）。
- 适配点：
  1. 去除 "use client"（Vite 不需要；保留会产生 Rollup 警告）。
  2. login-form / password-setup-screen：登录响应优先使用 redirect_to（消费方 ticket 回跳）。
- brand-provider 不复制（auth-center 用静态品牌版，另行手写）。
"""
import os

SRC = os.path.expanduser("~/IdeaProjects/python-service/snow_harness")
DST = os.path.expanduser("~/IdeaProjects/auth-center")

COPY_FILES = [
    # lib（品牌合同与投影）
    ("lib/branding/brand-contract.ts", "lib/branding/brand-contract.ts"),
    ("lib/branding/brand-presentation.ts", "lib/branding/brand-presentation.ts"),
    # UI 基础件
    ("components/ui/button.tsx", "components/ui/button.tsx"),
    ("components/ui/input.tsx", "components/ui/input.tsx"),
    ("components/ui/label.tsx", "components/ui/label.tsx"),
    # 品牌组件（wordmark；provider 手写）
    ("components/brand/brand-wordmark.tsx", "components/brand/brand-wordmark.tsx"),
    # 认证组件
    ("components/auth/auth-screen-layout.tsx", "components/auth/auth-screen-layout.tsx"),
    ("components/auth/login-form.tsx", "components/auth/login-form.tsx"),
    ("components/auth/login-screen.tsx", "components/auth/login-screen.tsx"),
    ("components/auth/external-auth-zone.tsx", "components/auth/external-auth-zone.tsx"),
    ("components/auth/password-setup-screen.tsx", "components/auth/password-setup-screen.tsx"),
]


def strip_use_client(src: str) -> str:
    if src.startswith('"use client";\n'):
        src = src[len('"use client";\n'):]
        if src.startswith("\n"):
            src = src[1:]
    return src


def adapt_login_form(src: str) -> str:
    old1 = "| { authenticated: true; return_to: string }"
    new1 = "| { authenticated: true; return_to: string; redirect_to?: string }"
    assert old1 in src, "login-form: response type anchor missing"
    src = src.replace(old1, new1, 1)

    old2 = """          if (onAuthenticated) {
            onAuthenticated(body.return_to);
          } else {
            window.location.assign(apiPath(body.return_to));
          }"""
    new2 = """          const destination = body.redirect_to ?? body.return_to;
          if (onAuthenticated) {
            onAuthenticated(destination);
          } else {
            window.location.assign(apiPath(destination));
          }"""
    assert old2 in src, "login-form: redirect block anchor missing"
    src = src.replace(old2, new2, 1)
    return src


def adapt_password_setup(src: str) -> str:
    old1 = "| { authenticated: true; return_to: string }"
    new1 = "| { authenticated: true; return_to: string; redirect_to?: string }"
    assert old1 in src, "password-setup: response type anchor missing"
    src = src.replace(old1, new1, 1)

    old2 = """            if (onAuthenticated) onAuthenticated(body.return_to);
            else window.location.assign(apiPath(body.return_to));"""
    new2 = """            const destination = body.redirect_to ?? body.return_to;
            if (onAuthenticated) onAuthenticated(destination);
            else window.location.assign(apiPath(destination));"""
    assert old2 in src, "password-setup: redirect block anchor missing"
    src = src.replace(old2, new2, 1)
    return src


def main() -> None:
    for src_rel, dst_rel in COPY_FILES:
        src_path = os.path.join(SRC, src_rel)
        dst_path = os.path.join(DST, dst_rel)
        data = open(src_path, "rb").read().decode("utf-8")

        data = strip_use_client(data)
        if dst_rel.endswith("login-form.tsx"):
            data = adapt_login_form(data)
        if dst_rel.endswith("password-setup-screen.tsx"):
            data = adapt_password_setup(data)

        os.makedirs(os.path.dirname(dst_path), exist_ok=True)
        open(dst_path, "wb").write(data.encode("utf-8"))
        print(f"✓ {dst_rel}")

    # ── styles.css：从 globals.css 提取 token 段（:root 32-102 / .dark 103-155 /
    #    @theme inline 156-221 / @layer base 222-233）──
    globals_css = open(os.path.join(SRC, "app/globals.css"), "rb").read().decode("utf-8")
    lines = globals_css.split("\n")
    tokens = "\n".join(lines[31:233])  # 0-based：行 32 → index 31；行 233 → index 232 含

    assert ":root {" in tokens and "@layer base {" in tokens and tokens.rstrip().endswith("}")
    # 修正自引用字体变量（nexharness 由更大上下文解析；此处显式指向字体栈）
    old_font = "  --font-sans: var(--font-sans);"
    assert old_font in tokens, "font-sans anchor missing"
    tokens = tokens.replace(old_font, "  --font-sans: var(--font-hanken);", 1)

    styles = (
        "/* auth-center 门户样式：\n"
        " * 语义 token 体系从 nexharness app/globals.css 提取（:root 浅色 + .dark 暗色\n"
        " * + @theme inline 映射 + @layer base），保持与平台一致的视觉基线。\n"
        " * 未引入 tw-animate-css / shadcn 变体工具（门户未使用其特性）。 */\n"
        '@import "tailwindcss";\n\n'
        "@custom-variant dark (&:is(.dark *));\n\n"
        + tokens
        + "\n"
    )
    styles_path = os.path.join(DST, "web/src/styles.css")
    open(styles_path, "wb").write(styles.encode("utf-8"))
    print(f"✓ web/src/styles.css（{styles.count(chr(10)) + 1} 行，token 段提取）")


if __name__ == "__main__":
    main()
