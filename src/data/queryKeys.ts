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
