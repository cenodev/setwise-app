import type { SwapIntent } from "./swapRouter/schema";

export const setQueryKeys = {
  list: ["sets"] as const,
  detail: (poolId: string) => ["sets", poolId] as const,
  state: (poolId: string) => ["sets", poolId, "state"] as const,
  directory: (registryFingerprint: string) => ["sets", "directory", registryFingerprint] as const,
  portfolio: (registryFingerprint: string) => ["sets", "portfolio", registryFingerprint] as const,
};

export const tokenListQueryKeys = {
  all: ["token-list"] as const,
  catalog: ["token-list", "catalog"] as const,
};

export const assetMetricsQueryKeys = {
  all: ["asset-metrics"] as const,
};

export const swapRouterQueryKeys = {
  all: ["swap-router"] as const,
  capabilities: () => ["swap-router", "capabilities"] as const,
  quotes: (intent: SwapIntent) => ["swap-router", "quotes", intent] as const,
  status: (providerId: string, quoteId: string) => ["swap-router", "status", providerId, quoteId] as const,
};
