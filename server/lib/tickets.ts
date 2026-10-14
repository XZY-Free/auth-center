/**
 * 登录票据（一次性授权码）存储。
 *
 * 用途：消费方（nexharness 等）统一走 auth-center 登录门户；登录完成后
 * auth-center 把用户回跳到消费方地址并附 `?ticket=`；消费方服务端调用
 * `POST /api/session/resolve` 用票据一次性换取 会话 token + 身份 + 权限快照。
 *
 * 语义：
 * - 一次性：consume 成功即标记已用，重复使用返回 null。
 * - 短 TTL（默认 60s）：过期即失效，不做持久化。
 * - 换票必须服务端进行（消费方后端），票据不直接当凭证使用。
 *
 * 单实例内存实现（auth-center 当前单副本部署）。多副本/多实例前必须
 * 换成共享存储（Redis/DB）——本模块是唯一变更点。
 */
import { randomBytes } from "node:crypto";

const TICKET_TTL_MS = 60_000;
const MAX_STORE_ENTRIES = 10_000;

export interface TicketRecord {
  /** 兑换目标（发起登录时的 returnTo 外部地址），仅用于审计与校验。 */
  readonly returnTo: string;
  readonly sessionToken: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

interface StoredTicket extends TicketRecord {
  consumed: boolean;
}

const store = new Map<string, StoredTicket>();

function sweep(now: number): void {
  for (const [key, record] of store) {
    if (record.consumed || record.expiresAt <= now) store.delete(key);
  }
  // 极端防爆：超限时丢弃最旧条目（正常量级远低于上限）。
  if (store.size > MAX_STORE_ENTRIES) {
    const excess = store.size - MAX_STORE_ENTRIES;
    let removed = 0;
    for (const key of store.keys()) {
      store.delete(key);
      if (++removed >= excess) break;
    }
  }
}

/** 签发一次性票据。 */
export function issueTicket(input: { sessionToken: string; returnTo: string }): string {
  const now = Date.now();
  sweep(now);
  const ticket = randomBytes(32).toString("base64url");
  store.set(ticket, {
    returnTo: input.returnTo,
    sessionToken: input.sessionToken,
    issuedAt: now,
    expiresAt: now + TICKET_TTL_MS,
    consumed: false,
  });
  return ticket;
}

/** 消费一次性票据；无效/已用/过期返回 null。 */
export function consumeTicket(ticket: string): TicketRecord | null {
  if (!ticket || ticket.length > 256) return null;
  const now = Date.now();
  const record = store.get(ticket);
  if (!record) return null;
  if (record.consumed || record.expiresAt <= now) {
    store.delete(ticket);
    return null;
  }
  record.consumed = true;
  store.delete(ticket);
  return {
    returnTo: record.returnTo,
    sessionToken: record.sessionToken,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
  };
}
