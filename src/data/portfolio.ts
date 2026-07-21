import { isAddressEqual } from "viem";

import type { Pool, PoolState } from "./rfq/deposits";
import type { SetDefinition } from "./sets";

export type PortfolioSetSnapshotState =
  | Readonly<{ definition: SetDefinition; status: "unsupported-chain" }>
  | Readonly<{ definition: SetDefinition; error: Error; status: "error" }>
  | Readonly<{
    definition: SetDefinition;
    pool: Pool;
    state: PoolState;
    status: "ready" | "stale";
  }>;

export type LoadPortfolioSetSnapshotsInput = Readonly<{
  concurrency?: number;
  definitions: readonly SetDefinition[];
  loadPool: (poolId: string) => Promise<Pool>;
  loadState: (poolId: string) => Promise<PoolState>;
  nowMs?: number;
  staleAfterMs: number;
}>;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Unable to load Set data", { cause: error });
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Portfolio concurrency must be a positive integer");
  }
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index] as T;
      results[index] = await task(value, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

function validateSnapshot(definition: SetDefinition, pool: Pool, state: PoolState): void {
  if (definition.id !== pool.id
    || pool.id !== state.poolId
    || definition.chainId !== pool.chain.id
    || pool.chain.id !== state.chainId
    || !isAddressEqual(pool.contract.address, state.poolAddress)) {
    throw new Error(`Set ${definition.id} returned mismatched definition and state data`);
  }
}

export async function loadPortfolioSetSnapshots(
  input: LoadPortfolioSetSnapshotsInput,
): Promise<PortfolioSetSnapshotState[]> {
  const nowMs = input.nowMs ?? Date.now();
  return mapWithConcurrency(input.definitions, input.concurrency ?? 3, async (definition) => {
    if (!definition.supported) return { definition, status: "unsupported-chain" };
    try {
      const [pool, state] = await Promise.all([
        input.loadPool(definition.id),
        input.loadState(definition.id),
      ]);
      validateSnapshot(definition, pool, state);
      const observedAt = Date.parse(state.blockTimestamp);
      const status = Number.isFinite(observedAt) && nowMs - observedAt <= input.staleAfterMs
        ? "ready"
        : "stale";
      return { definition, pool, state, status };
    } catch (error) {
      return { definition, error: toError(error), status: "error" };
    }
  });
}

export function portfolioRegistryFingerprint(definitions: readonly SetDefinition[]): string {
  return definitions
    .map((definition) => `${definition.id}:${definition.chainId}:${definition.pool.contract.address.toLowerCase()}`)
    .sort()
    .join("|");
}
