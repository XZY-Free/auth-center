/**
 * 门户首页（控制台占位）。
 *
 * - 未登录 → 回登录页。
 * - 已登录 → 显示当前身份 + 退出入口；管理台（用户/角色/权限/治理）
 *   在其移植完成后挂载到本路由。
 */
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

interface PrincipalView {
  readonly displayName?: string | null;
  readonly email?: string;
  readonly tenantKey?: string;
}

export function HomePage() {
  const [status, setStatus] = useState<"checking" | "anonymous" | "authenticated">("checking");
  const [principal, setPrincipal] = useState<PrincipalView | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await apiFetch("/api/session/introspect", { method: "POST" }).catch(
        () => null,
      );
      if (cancelled) return;
      if (response?.ok) {
        const body = (await response.json().catch(() => null)) as {
          principal?: PrincipalView;
        } | null;
        setPrincipal(body?.principal ?? null);
        setStatus("authenticated");
      } else {
        setStatus("anonymous");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "checking") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        正在加载…
      </main>
    );
  }
  if (status === "anonymous") {
    return <Navigate to="/login" replace />;
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
      <section className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.02em]">NexHarness 身份中心</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            已登录：{principal?.displayName ?? principal?.email ?? "当前用户"}
          </p>
        </div>
        <div className="rounded-xl border border-border-strong px-4 py-3 text-sm text-muted-foreground">
          管理台（用户 / 角色 / 权限 / 生命周期治理）正在移植中。
        </div>
        <Button
          variant="outline"
          className="h-9 rounded-[10px]"
          disabled={loggingOut}
          onClick={async () => {
            setLoggingOut(true);
            await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => null);
            window.location.assign("/login");
          }}
        >
          {loggingOut ? "正在退出…" : "退出登录"}
        </Button>
      </section>
    </main>
  );
}
