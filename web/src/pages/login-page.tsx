/**
 * 登录页（react-router 版）。
 *
 * 对应 nexharness `app/login/page.tsx` 的客户端等价实现：
 * - 已有有效会话 → 直接回跳 returnTo（原为服务端 resolvePrincipal + redirect）。
 * - 拉取外部认证区配置（/api/auth/external-methods）后渲染登录表单。
 */
import { LoginScreen } from "@/components/auth/login-screen";
import { apiFetch } from "@/lib/api-fetch";
import type { ExternalAuthZoneConfig } from "@/lib/identity/authentication-provider";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { readReturnTo } from "./return-to";

export function LoginPage() {
  const [params] = useSearchParams();
  const returnTo = readReturnTo(params.get("returnTo"));
  const [ready, setReady] = useState(false);
  const [externalAuth, setExternalAuth] = useState<ExternalAuthZoneConfig | undefined>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 已有有效会话 → 走服务端票据端点回跳：
      // 外部消费方地址会收到新签发的一次性 ticket，站内相对路径直接 302。
      const session = await apiFetch("/api/session/introspect", { method: "POST" }).catch(
        () => null,
      );
      if (cancelled) return;
      if (session?.ok) {
        window.location.assign(`/api/auth/ticket?returnTo=${encodeURIComponent(returnTo)}`);
        return;
      }
      const response = await apiFetch(
        `/api/auth/external-methods?returnTo=${encodeURIComponent(returnTo)}`,
      ).catch(() => null);
      const body = (await response?.json().catch(() => null)) as {
        external_auth?: ExternalAuthZoneConfig | null;
      } | null;
      if (cancelled) return;
      setExternalAuth(body?.external_auth ?? undefined);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [returnTo]);

  if (!ready) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        正在加载登录…
      </main>
    );
  }
  return <LoginScreen returnTo={returnTo} externalAuth={externalAuth} />;
}
