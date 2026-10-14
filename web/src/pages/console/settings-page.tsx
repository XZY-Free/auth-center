/**
 * 平台设置页（成员与权限 + 外观）。
 *
 * 对应 nexharness `app/studio/settings/page.tsx` 的客户端等价实现：
 * - 原服务端页级守卫（user.manage）→ 接口侧守卫（403 → GatePage；401 → 登录页）。
 * - 初始视图由 GET /api/console/settings/permissions 拉取后交给 PermissionManager。
 */
import { AppearanceSetting } from "@/components/studio/appearance-setting";
import { StudioGatePage } from "@/components/studio/gate-page";
import { PermissionManager } from "@/components/studio/permission-manager";
import { StudioPage } from "@/components/studio/studio-page";
import {
  StudioSettingsRow,
  StudioSettingsSection,
} from "@/components/studio/studio-settings-section";
import type { PermissionManagementView } from "@/lib/identity/permission-management";
import { useEffect, useState } from "react";
import { fetchConsole, fetchCurrentPrincipal } from "./console-fetch";

export const CONSOLE_SETTINGS_RETURN_TO = "/console/settings";

type State =
  | { kind: "loading" }
  | { kind: "denied"; status: number; message: string }
  | { kind: "unreachable" }
  | { kind: "ready"; view: PermissionManagementView; currentUserId: string };

export function ConsoleSettingsPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const me = await fetchCurrentPrincipal(CONSOLE_SETTINGS_RETURN_TO);
      if (cancelled || !me) return;
      const result = await fetchConsole<PermissionManagementView>(
        "/api/console/settings/permissions",
        CONSOLE_SETTINGS_RETURN_TO,
      );
      if (cancelled) return;
      if (result.kind === "ok") {
        setState({ kind: "ready", view: result.data, currentUserId: me.userIdentityId });
      } else if (result.kind === "denied") {
        setState({ kind: "denied", status: result.status, message: result.message });
      } else {
        setState({ kind: "unreachable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") {
    return <div className="py-24 text-center text-sm text-muted-foreground">正在加载平台设置…</div>;
  }
  if (state.kind === "denied") {
    return <StudioGatePage status={state.status} message={state.message} />;
  }
  if (state.kind === "unreachable") {
    return (
      <div className="py-24 text-center text-sm text-muted-foreground">
        暂时无法连接服务器，请稍后刷新重试。
      </div>
    );
  }
  return (
    <StudioPage
      title="平台设置"
      description="管理成员、用户组和后台角色。智能体使用范围在「智能体访问」中配置。"
    >
      <div className="space-y-8">
        <StudioSettingsSection
          title="外观"
          description="主题偏好保存在本浏览器；跟随系统会实时响应系统深浅色切换。"
        >
          <StudioSettingsRow title="主题" description="默认跟随系统。">
            <AppearanceSetting />
          </StudioSettingsRow>
        </StudioSettingsSection>
        <StudioSettingsSection
          title="成员与权限"
          description="默认员工能力与后台管理职责分别配置。"
        >
          <PermissionManager initial={state.view} currentUserId={state.currentUserId} />
        </StudioSettingsSection>
      </div>
    </StudioPage>
  );
}
