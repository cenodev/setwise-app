import { isAddressEqual } from "viem";

import type { Pool, PoolState } from "../rfq/deposits";
import {
  createPoolPositionContracts,
  decodeWalletPoolPosition,
  type PoolPositionClient,
  type PoolPositionConnection,
  type WalletPoolPosition,
} from "./poolPosition";

export type PortfolioPoolSnapshot = Readonly<{
  pool: Pool;
  state: PoolState;
  status: "ready" | "stale";
}>;

export type PortfolioWalletPositionState =
  | Readonly<{ poolId: string; status: "disconnected" }>
  | Readonly<{ chainId: number; poolId: string; status: "unsupported-chain" }>
  | Readonly<{ error: Error; poolId: string; status: "error" }>
  | Readonly<{ poolId: string; position: WalletPoolPosition; status: "ready" | "zero-balance" | "stale" }>;

export type PortfolioWalletPositionsInput = Readonly<{
  clients: ReadonlyMap<number, PoolPositionClient>;
  connection: PoolPositionConnection;
  snapshots: readonly PortfolioPoolSnapshot[];
  supportedChainIds: ReadonlySet<number>;
}>;

type ReadableSnapshot = Readonly<{
  pool: Pool;
  state: PoolState;
  status: "ready" | "stale";
}>;

type BatchMember = Readonly<{
  contracts: ReturnType<typeof createPoolPositionContracts>;
  snapshot: ReadableSnapshot;
}>;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Portfolio wallet reads failed", { cause: error });
}

function contextError(snapshot: PortfolioPoolSnapshot): Error | undefined {
  if (snapshot.pool.id !== snapshot.state.poolId
    || snapshot.pool.chain.id !== snapshot.state.chainId
    || !isAddressEqual(snapshot.pool.contract.address, snapshot.state.poolAddress)) {
    return new Error(`The state snapshot for Set ${snapshot.pool.id} does not match its definition`);
  }
  return undefined;
}

function groupKey(snapshot: ReadableSnapshot): string {
  return `${snapshot.pool.chain.id}:${snapshot.state.blockNumber}`;
}

/**
 * Reads all compatible Sets in one multicall while keeping different chains and snapshot blocks
 * in separate batches. A failed batch affects only the Sets in that batch.
 */
export async function readPortfolioWalletPositions(
  input: PortfolioWalletPositionsInput,
): Promise<PortfolioWalletPositionState[]> {
  const { connection, snapshots, supportedChainIds } = input;
  if (connection.status === "disconnected") {
    return snapshots.map((snapshot) => ({ poolId: snapshot.pool.id, status: "disconnected" }));
  }

  const results = new Map<string, PortfolioWalletPositionState>();
  const batches = new Map<string, BatchMember[]>();
  for (const snapshot of snapshots) {
    const poolId = snapshot.pool.id;
    if (!supportedChainIds.has(snapshot.pool.chain.id)) {
      results.set(poolId, { chainId: snapshot.pool.chain.id, poolId, status: "unsupported-chain" });
      continue;
    }
    const error = contextError(snapshot);
    if (error) {
      results.set(poolId, { error, poolId, status: "error" });
      continue;
    }
    const key = groupKey(snapshot);
    const member = { contracts: createPoolPositionContracts(snapshot.pool, connection.account), snapshot };
    batches.set(key, [...(batches.get(key) ?? []), member]);
  }

  await Promise.all([...batches.values()].map(async (members) => {
    const first = members[0];
    if (!first) return;
    const { pool, state } = first.snapshot;
    const client = input.clients.get(pool.chain.id);
    if (!client || client.chain?.id !== pool.chain.id) {
      const error = new Error(`No public client is available for chain ${pool.chain.id}`);
      for (const member of members) {
        results.set(member.snapshot.pool.id, { error, poolId: member.snapshot.pool.id, status: "error" });
      }
      return;
    }

    const contracts = members.flatMap((member) => [...member.contracts]);
    try {
      const blockNumber = BigInt(state.blockNumber);
      const [batchResults, nativeBalance] = await Promise.all([
        client.multicall({ allowFailure: false, blockNumber, contracts }),
        client.getBalance({ address: connection.account, blockNumber }),
      ]);
      let offset = 0;
      for (const member of members) {
        const length = member.contracts.length;
        const position = decodeWalletPoolPosition({
          account: connection.account,
          nativeBalance,
          pool: member.snapshot.pool,
          poolState: member.snapshot.state,
          results: batchResults.slice(offset, offset + length),
        });
        const status = member.snapshot.status === "stale"
          ? "stale"
          : position.shares.totalAttributed === 0n
            ? "zero-balance"
            : "ready";
        results.set(member.snapshot.pool.id, { poolId: member.snapshot.pool.id, position, status });
        offset += length;
      }
    } catch (cause) {
      const error = toError(cause);
      for (const member of members) {
        results.set(member.snapshot.pool.id, { error, poolId: member.snapshot.pool.id, status: "error" });
      }
    }
  }));

  return snapshots.map((snapshot) => results.get(snapshot.pool.id) ?? {
    error: new Error(`Set ${snapshot.pool.id} did not produce a wallet result`),
    poolId: snapshot.pool.id,
    status: "error",
  });
}

export function portfolioWalletPositionsQueryKey(input: {
  connection: PoolPositionConnection;
  snapshots: readonly PortfolioPoolSnapshot[];
}) {
  const { connection, snapshots } = input;
  return [
    "portfolio-wallet-positions",
    connection.status === "connected" ? connection.account.toLowerCase() : null,
    connection.status === "connected" ? connection.chainId : null,
    snapshots.map(({ pool, state }) => [
      pool.id,
      pool.chain.id,
      pool.contract.address.toLowerCase(),
      state.blockNumber,
    ]),
  ] as const;
}
