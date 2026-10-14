/**
 * 会话事实读/写（consume 侧接口使用）。
 *
 * 与 local-authentication.ts 的分工：
 * - local-authentication：认证流（登录/设密/登出的业务逻辑）。
 * - 本模块：对 auth_session 的**最小事实访问**——给 introspect/resolve 提供
 *   到期时间，给 revoke 提供按 token 撤销。不引入新的业务语义。
 *
 * 会话 token 从不落库明文：一律经 hashSessionToken 换算 token_hash 后访问。
 */
import { db } from "@/lib/db/client";
import { hashSessionToken } from "@/lib/identity/local-authentication";
import { authSession } from "@/lib/persistence/schema/identity";
import { and, eq, gt, isNull } from "drizzle-orm";

export interface LiveSessionFacts {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userIdentityId: string;
  readonly sessionKind: "authenticated" | "password_enrollment";
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/**
 * 按原始 token 读取仍然有效（未撤销且未过期）的会话事实。
 * 不校验用户状态——用户状态属于认证链职责（authenticate/acceptAuthenticatedEvidence）。
 */
export async function getLiveSessionFactsByToken(token: string): Promise<LiveSessionFacts | null> {
  if (!token) return null;
  const [row] = await db
    .select({
      sessionId: authSession.id,
      tenantId: authSession.tenantId,
      userIdentityId: authSession.userIdentityId,
      sessionKind: authSession.sessionKind,
      expiresAt: authSession.expiresAt,
      createdAt: authSession.createdAt,
    })
    .from(authSession)
    .where(
      and(
        eq(authSession.tokenHash, hashSessionToken(token)),
        isNull(authSession.revokedAt),
        gt(authSession.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * 按原始 token 撤销会话（幂等）：已撤销/不存在时返回 false。
 * 撤销即时生效：下一个请求的 authenticate() 即无法命中该会话。
 */
export async function revokeSessionByToken(token: string): Promise<boolean> {
  if (!token) return false;
  const result = await db
    .update(authSession)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSession.tokenHash, hashSessionToken(token)), isNull(authSession.revokedAt)));
  return result[0].affectedRows > 0;
}
