/**
 * auth-center schema 入口（应用查询用）。
 *
 * 迁移生成的入口只包含本仓 19 表——见 drizzle.config.ts；
 * 本文件额外导出外部引用表（agents / audit / control-plane，属 nexharness）。
 */
export * from "./identity";
export * from "./authorization";
export * from "./deletion-request";
export * from "./retention-policy";
export * from "./security-incident";

// ── 外部引用表（属 nexharness；本仓读写引用、不迁移）──
export * from "./agents";
export * from "./audit";
export * from "./control-plane";
