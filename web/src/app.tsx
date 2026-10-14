/**
 * auth-center 门户（react-router）。
 *
 * 路由：
 * - /login            登录门户（本地登录 + 外部认证区）
 * - /setup-password   首次设密
 * - /                 门户首页（控制台占位；管理台后续挂载）
 * - *                 兜底回登录页
 */
import { BrandProvider } from "@/components/brand/brand-provider";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
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
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrandProvider>
    </BrowserRouter>
  );
}
