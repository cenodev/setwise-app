import { useQuery } from "@tanstack/react-query";

import { runtimeConfig } from "../../config/env";
import { poolQueryKeys } from "../../data/queryKeys";
import { getPool, getPoolState } from "../../data/rfq/deposits";
import { useOnlineStatus } from "../../lib/useOnlineStatus";
import { PoolOverviewPage } from "./PoolOverviewPage";
import { PoolUserPosition } from "./PoolUserPosition";

export const POOL_STATE_REFRESH_INTERVAL_MS = 15_000;

export function PoolPage() {
  const online = useOnlineStatus();
  const poolQuery = useQuery({
    queryKey: poolQueryKeys.discovery(runtimeConfig.defaultPoolId),
    queryFn: ({ signal }) => getPool(runtimeConfig.defaultPoolId, signal),
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
  const poolStateQuery = useQuery({
    queryKey: poolQueryKeys.state(runtimeConfig.defaultPoolId),
    queryFn: ({ signal }) => getPoolState(runtimeConfig.defaultPoolId, signal),
    refetchInterval: online ? POOL_STATE_REFRESH_INTERVAL_MS : false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    staleTime: POOL_STATE_REFRESH_INTERVAL_MS,
  });
  const error = poolQuery.error ?? poolStateQuery.error;
  const hasPublicSnapshot = Boolean(poolQuery.data && poolStateQuery.data);
  const retry = () => {
    void poolQuery.refetch();
    void poolStateQuery.refetch();
  };

  return (
    <div className="pool-page">
      {!online && hasPublicSnapshot && (
        <aside className="warning-panel pool-stale-notice" role="status">
          <strong>You’re offline.</strong> Showing the most recently saved pool snapshot and wallet estimate.
        </aside>
      )}
      {online && hasPublicSnapshot && error && (
        <aside className="warning-panel pool-stale-notice" role="status">
          <strong>Live refresh failed.</strong> The last complete pool snapshot remains visible.
          <button className="inline-action" onClick={retry} type="button">Retry refresh</button>
        </aside>
      )}
      <PoolOverviewPage
        error={error}
        loading={poolQuery.isPending || poolStateQuery.isPending}
        onRetry={retry}
        online={online}
        pool={poolQuery.data}
        refreshing={Boolean(poolQuery.isFetching || poolStateQuery.isFetching)}
        state={poolStateQuery.data}
      />
      <aside className="pool-liquidity-note" role="note">
        <strong>Pool reserves are not market depth.</strong>
        <span>Usable balances describe assets held by this pool. External venue liquidity and executable prices may differ.</span>
      </aside>
      <PoolUserPosition pool={poolQuery.data} poolState={poolStateQuery.data} />
    </div>
  );
}
