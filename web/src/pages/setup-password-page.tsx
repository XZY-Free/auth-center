/**
 * 首次设密页（react-router 版）。
 *
 * 对应 nexharness `app/setup-password/page.tsx` 的客户端等价实现：
 * - 向 /api/auth/password-enrollment 查询设密会话；无效 → 回登录页（原为服务端 redirect）。
 * - 有效 → 渲染设密屏（账号来自企业登录，不可修改）。
 */
import { PasswordSetupScreen } from "@/components/auth/password-setup-screen";
import { apiFetch } from "@/lib/api-fetch";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { readReturnTo } from "./return-to";

export function SetupPasswordPage() {
  const [params] = useSearchParams();
  const returnTo = readReturnTo(params.get("returnTo"));
  const [account, setAccount] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await apiFetch("/api/auth/password-enrollment").catch(() => null);
      const body = response?.ok
        ? ((await response.json().catch(() => null)) as {
            enrollment?: { account?: string };
          } | null)
        : null;
      const value = body?.enrollment?.account;
      if (cancelled) return;
      if (!response?.ok || !value) {
        // 等价原服务端 redirect(`/login?returnTo=...`)。
        setRedirecting(true);
        window.location.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
        return;
      }
      setAccount(value);
    })();
    return () => {
      cancelled = true;
    };
  }, [returnTo]);

  if (redirecting || account === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        正在加载设密会话…
      </main>
    );
  }
  return <PasswordSetupScreen account={account} returnTo={returnTo} />;
}
