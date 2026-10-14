/**
 * 智能体访问列表页：智能体目录 → 进入使用范围/协作权限管理。
 */
import { StudioGatePage } from "@/components/studio/gate-page";
import { StudioPage } from "@/components/studio/studio-page";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchConsole } from "./console-fetch";

const RETURN_TO = "/console/agents";

interface AgentRow {
  id: string;
  agentKey: string;
  displayName: string;
  lifecycleState: string;
  currentRevisionId: string | null;
}

const STATE_LABEL: Record<string, string> = {
  draft: "草稿",
  enabled: "已启用",
  disabled: "已停用",
  archived: "已归档",
};

type State =
  | { kind: "loading" }
  | { kind: "denied"; status: number; message: string }
  | { kind: "unreachable" }
  | { kind: "ready"; agents: AgentRow[] };

export function ConsoleAgentsPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchConsole<{ agents: AgentRow[] }>("/api/console/agents", RETURN_TO);
      if (cancelled) return;
      if (result.kind === "ok") {
        setState({ kind: "ready", agents: result.data.agents });
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
    return <div className="py-24 text-center text-sm text-muted-foreground">正在加载智能体…</div>;
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
      title="智能体访问"
      description="选择智能体，配置使用范围（谁能调用）与协作权限（谁能编辑和发布）。"
    >
      {state.agents.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          当前还没有智能体。在平台中创建智能体后，可在此配置使用范围。
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {state.agents.map((agent) => (
            <Link
              key={agent.id}
              to={`/console/agents/${agent.id}`}
              className="group grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-6 px-4 py-3.5 outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="truncate text-sm font-medium text-foreground">
                  {agent.displayName}
                </div>
                <div className="text-xs text-muted-foreground">{agent.agentKey}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-[5px] bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {STATE_LABEL[agent.lifecycleState] ?? agent.lifecycleState}
                </span>
                <ChevronRight
                  className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </div>
            </Link>
          ))}
        </div>
      )}
    </StudioPage>
  );
}
