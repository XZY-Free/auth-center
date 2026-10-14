/**
 * 单个智能体的访问设置页（使用范围 + 协作权限）。
 * 组件内自带授权（studio.access + 负责人/user.manage），403 由组件消息区展示。
 */
import { AgentAccessManager } from "@/components/studio/agent-access-manager";
import { StudioPage } from "@/components/studio/studio-page";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";

export function ConsoleAgentAccessPage() {
  const { agentId = "" } = useParams();

  if (!agentId) {
    return (
      <StudioPage title="智能体访问设置">
        <p className="text-sm text-muted-foreground">缺少智能体标识。</p>
      </StudioPage>
    );
  }

  return (
    <StudioPage
      title="智能体访问设置"
      description="使用范围控制谁能调用；协作权限控制谁能编辑和发布。智能体仍须启用并完成发布。"
    >
      <div className="space-y-5">
        <Link
          to="/console/agents"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          返回智能体列表
        </Link>
        <AgentAccessManager agentId={agentId} />
      </div>
    </StudioPage>
  );
}
