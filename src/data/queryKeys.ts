export const poolQueryKeys = {
  discovery: (poolId: string) => ["pool", poolId] as const,
  state: (poolId: string) => ["pool-state", poolId] as const,
};

export const setQueryKeys = {
  list: ["sets"] as const,
  detail: (poolId: string) => ["sets", poolId] as const,
  state: (poolId: string) => ["sets", poolId, "state"] as const,
};

export const tokenListQueryKeys = {
  all: ["token-list"] as const,
};
