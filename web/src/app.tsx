/**
 * auth-center 门户（react-router）。
 *
 * 路由：
 * - /login            登录门户（本地登录 + 外部认证区）
 * - /setup-password   首次设密
 * - /                 门户首页（已登录信息 + 管理台入口）
 * - /console           管理台（成员与权限 / 智能体访问）
 * - *                 兜底回登录页
 */
import { BrandProvider } from "@/components/brand/brand-provider";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ConsoleAgentAccessPage } from "./pages/console/agent-access-page";
import { ConsoleAgentsPage } from "./pages/console/agents-page";
import { ConsoleLayout } from "./pages/console/console-layout";
import { ConsoleSettingsPage } from "./pages/console/settings-page";
import { HomePage } from "./pages/home-page";
import { LoginPage } from "./pages/login-page";
import { SetupPasswordPage } from "./pages/setup-password-page";

export function App() {
  return (
    <BrowserRouter>
      <BrandProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup-password" element={<SetupPasswordPage />} />
          <Route path="/" element={<HomePage />} />
          <Route path="/console" element={<ConsoleLayout />}>
            <Route index element={<Navigate to="settings" replace />} />
            <Route path="settings" element={<ConsoleSettingsPage />} />
            <Route path="agents" element={<ConsoleAgentsPage />} />
            <Route path="agents/:agentId" element={<ConsoleAgentAccessPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrandProvider>
    </BrowserRouter>
  );
}
