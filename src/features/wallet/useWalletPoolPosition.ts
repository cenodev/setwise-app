import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAccount, usePublicClient } from "wagmi";

import {
  PoolPositionContextError,
  readWalletPoolPosition,
  walletPoolPositionQueryKey,
  type PoolPositionConnection,
  type WalletPoolPositionState,
} from "../../data/chain/poolPosition";
import type { Pool, PoolState } from "../../data/rfq/deposits";

export type WalletPoolPositionHookState = WalletPoolPositionState
  | { status: "loading" }
  | { error: Error; status: "context-error" };

export type WalletPoolPositionHookResult = {
  query: UseQueryResult<WalletPoolPositionState, Error>;
  state: WalletPoolPositionHookState;
};

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Unable to read the wallet pool position", { cause: error });
}

/**
 * Presentation-free wallet position query. Consumers supply the already-discovered pool and its
 * state snapshot; the reader pins every wallet read to that snapshot's block number.
 */
export function useWalletPoolPosition(
  pool: Pool | undefined,
  poolState: PoolState | undefined,
): WalletPoolPositionHookResult {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: pool?.chain.id });
  const connection = useMemo<PoolPositionConnection>(() => (
    isConnected && address && chainId
      ? { account: address, chainId, status: "connected" }
      : { status: "disconnected" }
  ), [address, chainId, isConnected]);
  const hasReadContext = Boolean(pool && poolState && publicClient && connection.status === "connected");
  const correctNetwork = connection.status !== "connected" || !pool || connection.chainId === pool.chain.id;
  const queryKey = pool && poolState
    ? walletPoolPositionQueryKey({ connection, pool, poolState, requestedAccount: address })
    : [
      "wallet-pool-position",
      "awaiting-pool-snapshot",
      connection.status === "connected" ? connection.chainId : null,
      address?.toLowerCase() ?? null,
    ] as const;

  const query = useQuery<WalletPoolPositionState, Error>({
    queryKey,
    enabled: hasReadContext && correctNetwork,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 0,
    queryFn: async () => {
      if (!pool || !poolState || !publicClient || connection.status !== "connected" || !address) {
        throw new PoolPositionContextError("The wallet pool-position query is missing its read context");
      }
      return readWalletPoolPosition({
        client: publicClient,
        connection,
        pool,
        poolState,
        requestedAccount: address,
      });
    },
  });

  let state: WalletPoolPositionHookState;
  if (connection.status === "disconnected") {
    state = { status: "disconnected" };
  } else if (pool && connection.chainId !== pool.chain.id) {
    state = {
      account: connection.account,
      actualChainId: connection.chainId,
      expectedChainId: pool.chain.id,
      status: "wrong-network",
    };
  } else if (query.error) {
    state = { error: toError(query.error), status: "context-error" };
  } else {
    state = query.data ?? { status: "loading" };
  }

  return { query, state };
}
