import type { PoolSummary } from "./rfq/pools";

export type SetDefinition = {
  chainId: number;
  chainName: string | null;
  id: string;
  pool: PoolSummary;
  supported: boolean;
};

export type SetResolution =
  | { status: "loading" }
  | { error: Error; status: "error" }
  | { poolId: string; status: "not-found" }
  | { definition: SetDefinition; status: "unsupported-chain" }
  | { definition: SetDefinition; status: "ready" };

export function toSetDefinition(pool: PoolSummary, supportedChainId: number): SetDefinition {
  return {
    chainId: pool.chain.id,
    chainName: pool.chain.name,
    id: pool.id,
    pool,
    supported: pool.chain.id === supportedChainId,
  };
}

export function resolveSet(
  poolId: string,
  pools: PoolSummary[] | undefined,
  supportedChainId: number,
): SetResolution {
  if (!pools) return { status: "loading" };
  const match = pools.find((p) => p.id === poolId);
  if (!match) return { poolId, status: "not-found" };
  const definition = toSetDefinition(match, supportedChainId);
  if (!definition.supported) return { definition, status: "unsupported-chain" };
  return { definition, status: "ready" };
}
