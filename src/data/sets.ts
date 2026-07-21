import type { PoolSummary } from "./rfq/pools";
import type { Pool, PoolState } from "./rfq/deposits";

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

export class SetSnapshotMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetSnapshotMismatchError";
  }
}

export function validateSetState(
  definition: SetDefinition,
  state: PoolState,
): SetSnapshotMismatchError | null {
  if (state.poolId !== definition.id) {
    return new SetSnapshotMismatchError("The live state belongs to a different Set.");
  }
  if (state.chainId !== definition.chainId) {
    return new SetSnapshotMismatchError("The live state belongs to a different chain.");
  }
  if (state.poolAddress.toLowerCase() !== definition.pool.contract.address.toLowerCase()) {
    return new SetSnapshotMismatchError("The live state belongs to a different Set contract.");
  }
  return null;
}

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

/**
 * Refuse to combine registry, detail, and state payloads unless every identity field agrees.
 * This is deliberately strict: a stale or misrouted response must never appear under another Set URL.
 */
export function validateSetSnapshot(
  routePoolId: string,
  definition: SetDefinition,
  pool: Pool,
  state: PoolState,
): SetSnapshotMismatchError | null {
  const registryAddress = definition.pool.contract.address.toLowerCase();
  const detailAddress = pool.contract.address.toLowerCase();
  const stateAddress = state.poolAddress.toLowerCase();

  if (routePoolId !== definition.id || definition.pool.id !== definition.id) {
    return new SetSnapshotMismatchError("The Set route and registry definition do not match.");
  }
  if (pool.id !== definition.id || state.poolId !== definition.id) {
    return new SetSnapshotMismatchError("The Set detail or live state belongs to a different Set.");
  }
  if (pool.chain.id !== definition.chainId) {
    return new SetSnapshotMismatchError("The Set registry, detail, and live state chain IDs do not match.");
  }
  if (detailAddress !== registryAddress) {
    return new SetSnapshotMismatchError("The Set registry, detail, and live state contract addresses do not match.");
  }
  const stateError = validateSetState(definition, state);
  if (!stateError) return null;
  if (state.chainId !== definition.chainId) {
    return new SetSnapshotMismatchError("The Set registry, detail, and live state chain IDs do not match.");
  }
  if (stateAddress !== registryAddress) {
    return new SetSnapshotMismatchError("The Set registry, detail, and live state contract addresses do not match.");
  }
  return stateError;
}
