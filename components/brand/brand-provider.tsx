/**
 * BrandProvider：auth-center 门户品牌上下文（静态版）。
 *
 * 适配说明：nexharness 的 BrandProvider 通过 /api/brand + SSE 做品牌热更新
 * （DB 品牌文档为主存储）；auth-center 门户使用**代码默认品牌**（NexHarness），
 * 不引入品牌存储与推送链路（动态品牌管理是 nexharness 平台能力）。
 * 组件消费面（useBrand → BrandPresentation）与源实现一致。
 */
import { DEFAULT_BRAND } from "@/lib/branding/brand-contract";
import { type BrandPresentation, toBrandPresentation } from "@/lib/branding/brand-presentation";
import { type ReactNode, createContext, useContext, useState } from "react";

const BrandContext = createContext<BrandPresentation>(toBrandPresentation(DEFAULT_BRAND));

export function BrandProvider({
  initial,
  children,
}: {
  readonly initial?: BrandPresentation;
  readonly children: ReactNode;
}) {
  const [presentation] = useState<BrandPresentation>(initial ?? toBrandPresentation(DEFAULT_BRAND));

  return <BrandContext.Provider value={presentation}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandPresentation {
  return useContext(BrandContext);
}
