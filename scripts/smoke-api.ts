/**
 * 接口冒烟（真实服务 + 真实数据库）。
 *
 * 前置：auth-center 已在 AUTH_CENTER_BASE_URL（默认 http://127.0.0.1:3100）运行。
 * 覆盖：
 *  1. GET  /health
 *  2. POST /api/auth/login（真实账号）→ 会话 cookie + 外部回跳 ticket
 *  3. POST /api/session/resolve（票据一次性换取会话 + 快照）
 *  4. POST /api/session/introspect（Bearer）
 *  5. GET  /api/permissions/snapshot（Bearer）
 *  6. POST /api/authorize（studio.access @ tenant）
 *  7. GET  /api/directory/users/:id 与 POST /api/directory/users/batch
 *  8. POST /api/enterprise/user-context（none→null / 无资料源 409 / 主体不匹配 403 / 非法字段 400 / 匿名 401）
 *  9. POST /api/session/revoke → introspect 立即 401（撤销即时生效）
 * 10. GET  /api/auth/external-methods
 * 11. 票据一次性校验（二次兑换必须失败）
 *
 * 账号：SMOKE_ADMIN_ACCOUNT（默认 admin@nexharness.local）；
 * 密码：SMOKE_ADMIN_PASSWORD 或 ~/.config/nexharness/dev-admin-password.txt。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.AUTH_CENTER_BASE_URL ?? "http://127.0.0.1:3100";
const ACCOUNT = process.env.SMOKE_ADMIN_ACCOUNT ?? "admin@nexharness.local";
const CONSUMER_RETURN_TO = "http://localhost:3000/chat";

function adminPassword(): string {
  if (process.env.SMOKE_ADMIN_PASSWORD) return process.env.SMOKE_ADMIN_PASSWORD.trim();
  const file =
    process.env.SMOKE_ADMIN_PASSWORD_FILE ??
    join(homedir(), ".config", "nexharness", "dev-admin-password.txt");
  return readFileSync(file, "utf-8").trim();
}

let failures = 0;
let checks = 0;

function expect(condition: boolean, label: string, detail?: unknown): void {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
    return;
  }
  failures += 1;
  console.error(`  ✗ ${label}`, detail !== undefined ? JSON.stringify(detail).slice(0, 300) : "");
}

async function call(
  path: string,
  init: RequestInit = {},
  // biome-ignore lint/suspicious/noExplicitAny: 冒烟脚本对响应体做动态断言，保留 any 以便断言语义直观。
): Promise<{ status: number; body: any; response: Response }> {
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  // biome-ignore lint/suspicious/noExplicitAny: 同上（JSON.parse 结果按用例断言）。
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, response };
}

async function main(): Promise<void> {
  console.log(`\n== auth-center 接口冒烟（${BASE}）==\n`);

  console.log("[1] /health");
  const health = await call("/health");
  expect(health.status === 200 && health.body?.ok === true, "健康检查 200 ok", health.body);

  console.log("[2] /api/auth/login（外部回跳 → ticket）");
  const password = adminPassword();
  const login = await call(`/api/auth/login?returnTo=${encodeURIComponent(CONSUMER_RETURN_TO)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account: ACCOUNT, password }),
  });
  expect(login.status === 200 && login.body?.authenticated === true, "登录成功", login.body);
  const setCookie = login.response.headers.get("set-cookie") ?? "";
  expect(setCookie.includes("nex_session="), "响应下发 nex_session cookie");
  const redirectTo: string = login.body?.redirect_to ?? "";
  expect(redirectTo.startsWith(`${CONSUMER_RETURN_TO}?ticket=`), "外部回跳携带 ticket", redirectTo);
  const ticket = redirectTo ? (new URL(redirectTo).searchParams.get("ticket") ?? "") : "";

  console.log("[3] /api/session/resolve（票据换会话 + 快照）");
  const resolve = await call("/api/session/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  expect(resolve.status === 200, "resolve 200", resolve.body);
  const principal = resolve.body?.principal;
  const snapshot = resolve.body?.snapshot;
  const sessionToken: string = resolve.body?.sessionToken ?? "";
  expect(Boolean(principal?.userIdentityId), "principal 含 userIdentityId", principal);
  expect(principal?.email === ACCOUNT, "principal.email 与登录账号一致", principal?.email);
  expect(Boolean(sessionToken), "返回 sessionToken");
  expect(Boolean(resolve.body?.expiresAt), "返回 expiresAt");
  expect(snapshot?.userId === principal?.userIdentityId, "快照绑定同一用户");
  expect(
    Array.isArray(snapshot?.grants) && snapshot.grants.length > 0,
    "快照 grants 非空（默认 member 授予）",
    snapshot?.grants?.length,
  );
  expect(Array.isArray(snapshot?.principalIds), "快照 principalIds 为数组");

  console.log("[4] 票据一次性");
  const replay = await call("/api/session/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  expect(replay.status === 403 || replay.status === 401, "票据二次兑换被拒", replay.status);

  const bearer = { authorization: `Bearer ${sessionToken}` };

  console.log("[5] /api/session/introspect（Bearer）");
  const introspect = await call("/api/session/introspect", { method: "POST", headers: bearer });
  expect(introspect.status === 200, "introspect 200", introspect.body);
  expect(
    introspect.body?.principal?.userIdentityId === principal?.userIdentityId,
    "introspect 身份一致",
  );
  expect(Boolean(introspect.body?.expiresAt), "introspect 含 expiresAt");

  console.log("[6] /api/permissions/snapshot（Bearer）");
  const snap = await call("/api/permissions/snapshot", { headers: bearer });
  expect(
    snap.status === 200 && typeof snap.body?.digest === "string",
    "snapshot 200 + digest",
    snap.status,
  );
  expect(snap.body?.userId === principal?.userIdentityId, "snapshot 用户一致");

  console.log("[7] /api/authorize（studio.access @ tenant）");
  const authorize = await call("/api/authorize", {
    method: "POST",
    headers: { ...bearer, "content-type": "application/json" },
    body: JSON.stringify({
      requests: [
        { actionCode: "studio.access", resource: { type: "tenant", id: null } },
        { actionCode: "agent.invoke", resource: { type: "agent", id: "smoke-nonexistent-agent" } },
      ],
    }),
  });
  expect(authorize.status === 200, "authorize 200", authorize.body);
  expect(
    Array.isArray(authorize.body?.decisions) && authorize.body.decisions.length === 2,
    "返回 2 条决策",
  );
  expect(typeof authorize.body?.decisions?.[0]?.allowed === "boolean", "决策含 allowed");
  expect(typeof authorize.body?.decisions?.[0]?.reason === "string", "决策含 reason");
  const invalid = await call("/api/authorize", {
    method: "POST",
    headers: { ...bearer, "content-type": "application/json" },
    body: JSON.stringify({
      requests: [{ actionCode: "not.a.code", resource: { type: "tenant", id: null } }],
    }),
  });
  expect(invalid.status === 400, "未知动作码 → 400", invalid.status);

  console.log("[8] /api/directory（单读 + 批量）");
  const users = await call(`/api/directory/users/${principal?.userIdentityId}`, {
    headers: bearer,
  });
  expect(
    users.status === 200 && users.body?.user?.id === principal?.userIdentityId,
    "目录单读命中",
    users.body,
  );
  const batch = await call("/api/directory/users/batch", {
    method: "POST",
    headers: { ...bearer, "content-type": "application/json" },
    body: JSON.stringify({ ids: [principal?.userIdentityId, "missing-user-id"] }),
  });
  expect(batch.status === 200 && batch.body?.users?.length === 1, "批量读只回存在项", batch.body);
  const anonymous = await call("/api/directory/users/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: [principal?.userIdentityId] }),
  });
  expect(anonymous.status === 401, "无凭证目录读 → 401", anonymous.status);

  console.log("[9] /api/enterprise/user-context（会话主体=目标用户）");
  const enterpriseNone = await call("/api/enterprise/user-context", {
    method: "POST",
    headers: { ...bearer, "content-type": "application/json" },
    body: JSON.stringify({
      tenantId: principal?.tenantId,
      userIdentityId: principal?.userIdentityId,
      profileRequirement: "none",
      allowedFields: [],
    }),
  });
  expect(
    enterpriseNone.status === 200 && enterpriseNone.body?.candidate === null,
    "none 要求 → candidate null",
    enterpriseNone.body,
  );
  const enterpriseUnavailable = await call("/api/enterprise/user-context", {
    method: "POST",
    headers: { ...bearer, "content-type": "application/json" },
    body: JSON.stringify({
      tenantId: principal?.tenantId,
      userIdentityId: principal?.userIdentityId,
      profileRequirement: "stale_allowed",
      allowedFields: [],
    }),
  });
  expect(
    enterpriseUnavailable.status === 409 &&
      enterpriseUnavailable.body?.error?.code === "ENTERPRISE_USER_CONTEXT_UNAVAILABLE",
    "开源部署无受信资料源 → 409 UNAVAILABLE（fail-closed）",
    enterpriseUnavailable.body,
  );
  const enterpriseMismatch = await call("/api/enterprise/user-context", {
    method: "POST",
    headers: { ...bearer, "content-type": "application/json" },
    body: JSON.stringify({
      tenantId: principal?.tenantId,
      userIdentityId: "another-user-id",
      profileRequirement: "stale_allowed",
      allowedFields: [],
    }),
  });
  expect(enterpriseMismatch.status === 403, "主体不匹配 → 403", enterpriseMismatch.status);
  const enterpriseInvalid = await call("/api/enterprise/user-context", {
    method: "POST",
    headers: { ...bearer, "content-type": "application/json" },
    body: JSON.stringify({
      tenantId: principal?.tenantId,
      userIdentityId: principal?.userIdentityId,
      profileRequirement: "fresh_required",
      allowedFields: ["not_registered_field"],
    }),
  });
  expect(enterpriseInvalid.status === 400, "未登记字段 → 400", enterpriseInvalid.body);
  const enterpriseAnonymous = await call("/api/enterprise/user-context", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenantId: principal?.tenantId,
      userIdentityId: principal?.userIdentityId,
      profileRequirement: "none",
      allowedFields: [],
    }),
  });
  expect(enterpriseAnonymous.status === 401, "匿名调用 → 401", enterpriseAnonymous.status);

  console.log("[10] /api/auth/external-methods");
  const external = await call("/api/auth/external-methods");
  expect(
    external.status === 200 && "external_auth" in (external.body ?? {}),
    "external-methods 200",
    external.body,
  );

  console.log("[11] /api/session/revoke → 撤销即时生效");
  const revoke = await call("/api/session/revoke", { method: "POST", headers: bearer });
  expect(revoke.status === 200 && revoke.body?.revoked === true, "revoke 成功", revoke.body);
  const afterRevoke = await call("/api/session/introspect", { method: "POST", headers: bearer });
  expect(afterRevoke.status === 401, "撤销后 introspect 401（fail-closed）", afterRevoke.status);

  console.log(`\n== 结果：${checks - failures}/${checks} 通过 ==\n`);
  if (failures > 0) process.exitCode = 1;
}

void main();
