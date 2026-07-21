import type { PoolState } from "./rfq/deposits";
import { validateSetState, type SetDefinition } from "./sets";

export const SET_DIRECTORY_LOAD_CONCURRENCY = 3;

export type SetDirectoryState =
  | Readonly<{ poolId: string; status: "unsupported-chain" }>
  | Readonly<{ error: Error; poolId: string; status: "error" }>
  | Readonly<{ poolId: string; state: PoolState; status: "ready" }>;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Unable to load Set state", { cause: error });
}

/** Load live Set states with a hard concurrency cap and isolate failures by Set. */
export async function loadSetDirectoryStates(input: Readonly<{
  concurrency?: number;
  definitions: readonly SetDefinition[];
  loadState: (poolId: string) => Promise<PoolState>;
}>): Promise<SetDirectoryState[]> {
  const concurrency = input.concurrency ?? SET_DIRECTORY_LOAD_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Set directory concurrency must be a positive integer");
  }

  const results = new Array<SetDirectoryState>(input.definitions.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < input.definitions.length) {
      const index = nextIndex;
      nextIndex += 1;
      const definition = input.definitions[index];
      if (!definition.supported) {
        results[index] = { poolId: definition.id, status: "unsupported-chain" };
        continue;
      }
      try {
        const state = await input.loadState(definition.id);
        const mismatch = validateSetState(definition, state);
        if (mismatch) throw mismatch;
        results[index] = { poolId: definition.id, state, status: "ready" };
      } catch (error) {
        results[index] = { error: toError(error), poolId: definition.id, status: "error" };
      }
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(concurrency, input.definitions.length) },
    worker,
  ));
  return results;
}

export function setDirectoryFingerprint(definitions: readonly SetDefinition[]): string {
  return definitions
    .map((definition) => `${definition.id}:${definition.chainId}:${definition.pool.contract.address.toLowerCase()}`)
    .sort()
    .join("|");
}
