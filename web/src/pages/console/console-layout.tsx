/**
 * 管理台控制台壳：顶栏 + 子路由出口。
 * 导航：成员与权限（/console/settings）、智能体访问（/console/agents）。
 */
import { NavLink, Outlet } from "react-router-dom";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
    isActive
      ? "bg-muted font-medium text-foreground"
      : "text-muted-foreground hover:text-foreground"
  }`;

export function ConsoleLayout() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-6 px-6">
          <NavLink
            to="/"
            className="text-sm font-semibold tracking-[-0.02em] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            NexHarness 身份中心
          </NavLink>
          <nav aria-label="管理台导航" className="flex items-center gap-1">
            <NavLink to="/console/settings" className={navClass}>
              成员与权限
            </NavLink>
            <NavLink to="/console/agents" className={navClass}>
              智能体访问
            </NavLink>
          </nav>
        </div>
      </header>
      <div className="mx-auto w-full max-w-5xl px-6 pb-16">
        <Outlet />
      </div>
    </div>
  );
}
