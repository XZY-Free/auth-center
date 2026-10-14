/**
 * 通用工具（auth-center 精简版；自 nexharness `lib/utils.ts` 摘取 cn / generateUUID）。
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 生成 v4 UUID（密码学安全，Node 20+/浏览器通用）。 */
export function generateUUID(): string {
  return crypto.randomUUID();
}
