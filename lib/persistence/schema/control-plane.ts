/* ─────────────────────────────────────────────────────────
 * 外部引用表 · 属 nexharness 侧 schema（auth-center 裁减版）。
 * 原版为跨控制面 re-export 便利模块（agents / routes / executions 等）；
 * 本仓只保留审计链路用到的 re-export——结构变更由 nexharness 主导，只加不删。
 * ───────────────────────────────────────────────────────── */

// ─── Audit ────────────────────────────────────────────────────────
export {
  AUDIT_ACTION_TYPES,
  AUDIT_ACTOR_TYPES,
  AUDIT_OUTCOMES,
  auditEvent,
} from "@/lib/persistence/schema/audit";
export type {
  AuditActionType,
  AuditActorType,
  AuditEvent,
  AuditOutcome,
  NewAuditEvent,
} from "@/lib/persistence/schema/audit";
