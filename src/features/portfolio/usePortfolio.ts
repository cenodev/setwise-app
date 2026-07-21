import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAccount, usePublicClient } from "wagmi";

import { requiredChainId } from "../../config/chains";
import {
  portfolioWalletPositionsQueryKey,
  readPortfolioWalletPositions,
  type PortfolioPoolSnapshot,
  type PortfolioWalletPositionState,
} from "../../data/chain/portfolioPositions";
import type { PoolPositionClient, PoolPositionConnection } from "../../data/chain/poolPosition";
import {
  loadPortfolioSetSnapshots,
  portfolioRegistryFingerprint,
  type PortfolioSetSnapshotState,
} from "../../data/portfolio";
import { poolQueryKeys, setQueryKeys } from "../../data/queryKeys";
import { getPool, getPoolState } from "../../data/rfq/deposits";
import { getPools } from "../../data/rfq/pools";
import { toSetDefinition } from "../../data/sets";
import {
  aggregatePublicTvl,
  aggregateUniqueExternalLiquidity,
  aggregateUserLiquidity,
  calculatePortfolioFreshness,
  type PortfolioAggregate,
  type PortfolioFreshness,
  type UniqueExternalLiquidity,
} from "./model";

export const PORTFOLIO_STATE_REFRESH_INTERVAL_MS = 15_000;
export const PORTFOLIO_STALE_AFTER_MS = 60_000;
export const PORTFOLIO_LOAD_CONCURRENCY = 3;

export type PortfolioSetView = Readonly<{
  snapshot: PortfolioSetSnapshotState;
  wallet?: PortfolioWalletPositionState;
}>;

export type PortfolioView = Readonly<{
  externalLiquidity: UniqueExternalLiquidity | undefined;
  externalLiquidityCoverage: Readonly<{ available: number; total: number }>;
  freshness: PortfolioFreshness;
  publicTvl: PortfolioAggregate;
  sets: readonly PortfolioSetView[];
  userLiquidity: PortfolioAggregate;
  walletLoading: boolean;
}>;

export type UsePortfolioResult = Readonly<{
  error: Error | null;
  loading: boolean;
  refreshing: boolean;
  retry: () => void;
  view: PortfolioView | undefined;
}>;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Unable to load the Set portfolio", { cause: error });
}

function readableSnapshots(snapshots: readonly PortfolioSetSnapshotState[]): PortfolioPoolSnapshot[] {
  return snapshots.flatMap((snapshot) => (
    snapshot.status === "ready" || snapshot.status === "stale"
      ? [{ pool: snapshot.pool, state: snapshot.state, status: snapshot.status }]
      : []
  ));
}

function walletForSnapshot(input: {
  connection: PoolPositionConnection;
  snapshot: PortfolioSetSnapshotState;
  walletResults: readonly PortfolioWalletPositionState[] | undefined;
}): PortfolioWalletPositionState {
  const { connection, snapshot, walletResults } = input;
  if (snapshot.status === "unsupported-chain") {
    return { chainId: snapshot.definition.chainId, poolId: snapshot.definition.id, status: "unsupported-chain" };
  }
  if (snapshot.status === "error") {
    return { error: snapshot.error, poolId: snapshot.definition.id, status: "error" };
  }
  if (connection.status === "disconnected") {
    return { poolId: snapshot.definition.id, status: "disconnected" };
  }
  return walletResults?.find((result) => result.poolId === snapshot.definition.id) ?? {
    error: new Error(`Wallet data for Set ${snapshot.definition.id} is not available yet`),
    poolId: snapshot.definition.id,
    status: "error",
  };
}

function buildView(input: {
  connection: PoolPositionConnection;
  nowMs: number;
  snapshots: readonly PortfolioSetSnapshotState[];
  walletLoading: boolean;
  walletResults: readonly PortfolioWalletPositionState[] | undefined;
}): PortfolioView {
  const sets = input.snapshots.map((snapshot) => ({
    snapshot,
    wallet: walletForSnapshot({
      connection: input.connection,
      snapshot,
      walletResults: input.walletResults,
    }),
  }));
  const publicTvl = aggregatePublicTvl(input.snapshots.map((snapshot) => ({
    state: snapshot.status === "ready" || snapshot.status === "stale" ? snapshot.state : undefined,
    status: snapshot.status,
  })));
  const userLiquidity = aggregateUserLiquidity(sets.map(({ snapshot, wallet }) => ({
    attributedSharesAtomic: wallet && "position" in wallet ? wallet.position.shares.totalAttributed : undefined,
    state: snapshot.status === "ready" || snapshot.status === "stale" ? snapshot.state : undefined,
    status: wallet?.status ?? "error",
  })));
  const timestamps = input.snapshots.map((snapshot) => (
    snapshot.status === "ready" || snapshot.status === "stale" ? snapshot.state.blockTimestamp : null
  ));
  const externalSources = input.snapshots.flatMap((snapshot) => (
    (snapshot.status === "ready" || snapshot.status === "stale") && snapshot.state.externalLiquiditySources
      ? [snapshot.state.externalLiquiditySources]
      : []
  ));
  return {
    externalLiquidity: externalSources.length > 0 ? aggregateUniqueExternalLiquidity(externalSources) : undefined,
    externalLiquidityCoverage: { available: externalSources.length, total: input.snapshots.length },
    freshness: calculatePortfolioFreshness(timestamps, input.nowMs, PORTFOLIO_STALE_AFTER_MS),
    publicTvl,
    sets,
    userLiquidity,
    walletLoading: input.walletLoading,
  };
}

export function usePortfolio(): UsePortfolioResult {
  const queryClient = useQueryClient();
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: requiredChainId });
  const connection = useMemo<PoolPositionConnection>(() => (
    isConnected && address && chainId
      ? { account: address, chainId, status: "connected" }
      : { status: "disconnected" }
  ), [address, chainId, isConnected]);

  const registryQuery = useQuery({
    queryKey: setQueryKeys.list,
    queryFn: ({ signal }) => getPools(signal),
    staleTime: 60_000,
  });
  const definitions = useMemo(
    () => (registryQuery.data ?? []).map((pool) => toSetDefinition(pool, requiredChainId)),
    [registryQuery.data],
  );
  const fingerprint = portfolioRegistryFingerprint(definitions);
  const snapshotsQuery = useQuery({
    queryKey: setQueryKeys.portfolio(fingerprint),
    enabled: registryQuery.isSuccess,
    queryFn: () => loadPortfolioSetSnapshots({
      concurrency: PORTFOLIO_LOAD_CONCURRENCY,
      definitions,
      loadPool: (poolId) => queryClient.fetchQuery({
        queryKey: poolQueryKeys.discovery(poolId),
        queryFn: ({ signal }) => getPool(poolId, signal),
        staleTime: 60_000,
      }),
      loadState: (poolId) => queryClient.fetchQuery({
        queryKey: poolQueryKeys.state(poolId),
        queryFn: ({ signal }) => getPoolState(poolId, signal),
        staleTime: 0,
      }),
      staleAfterMs: PORTFOLIO_STALE_AFTER_MS,
    }),
    refetchInterval: PORTFOLIO_STATE_REFRESH_INTERVAL_MS,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    staleTime: PORTFOLIO_STATE_REFRESH_INTERVAL_MS,
  });

  const snapshots = useMemo(() => snapshotsQuery.data ?? [], [snapshotsQuery.data]);
  const readable = useMemo(() => readableSnapshots(snapshots), [snapshots]);
  const clients = useMemo(() => {
    const result = new Map<number, PoolPositionClient>();
    if (publicClient) result.set(requiredChainId, publicClient);
    return result;
  }, [publicClient]);
  const walletQueryKey = portfolioWalletPositionsQueryKey({ connection, snapshots: readable });
  const walletQuery: UseQueryResult<PortfolioWalletPositionState[], Error> = useQuery({
    queryKey: walletQueryKey,
    enabled: connection.status === "connected" && readable.length > 0,
    // Snapshot refreshes change the query key; keep the previous positions while the new read
    // is pending so confirmed zero-balance Sets do not flash back into view, but drop them
    // when the account or chain changes so stale wallet data is never shown.
    placeholderData: (previousData, previousQuery) => (
      previousQuery
      && previousQuery.queryKey[1] === walletQueryKey[1]
      && previousQuery.queryKey[2] === walletQueryKey[2]
        ? previousData
        : undefined
    ),
    queryFn: () => readPortfolioWalletPositions({
      clients,
      connection,
      snapshots: readable,
      supportedChainIds: new Set([requiredChainId]),
    }),
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 0,
  });

  const error = registryQuery.error ?? snapshotsQuery.error ?? walletQuery.error;
  const view = snapshotsQuery.data
    ? buildView({
      connection,
      nowMs: snapshotsQuery.dataUpdatedAt,
      snapshots,
      walletLoading: connection.status === "connected" && walletQuery.isPending && readable.length > 0,
      walletResults: walletQuery.data,
    })
    : undefined;
  const retry = () => {
    void registryQuery.refetch();
    void snapshotsQuery.refetch();
    if (connection.status === "connected") void walletQuery.refetch();
  };
  return {
    error: error ? toError(error) : null,
    loading: registryQuery.isPending || snapshotsQuery.isPending,
    refreshing: registryQuery.isFetching || snapshotsQuery.isFetching || walletQuery.isFetching,
    retry,
    view,
  };
}
