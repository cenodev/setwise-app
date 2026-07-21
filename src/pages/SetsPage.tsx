import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { requiredChainId } from "../config/chains";
import { setQueryKeys } from "../data/queryKeys";
import {
  loadSetDirectoryStates,
  setDirectoryFingerprint,
} from "../data/setDirectory";
import { getPoolState } from "../data/rfq/deposits";
import { getPools } from "../data/rfq/pools";
import { toSetDefinition, type SetDefinition } from "../data/sets";
import { useTokenMetadata } from "../data/tokens";
import { SetDirectoryCard } from "../features/sets/SetDirectoryCard";
import { SET_STATE_REFRESH_INTERVAL_MS } from "../features/sets/SetDirectoryCard";
import { useOnlineStatus } from "../lib/useOnlineStatus";

export function sortSets(sets: SetDefinition[]): SetDefinition[] {
  return [...sets].sort((a, b) => (
    a.pool.display.sortOrder - b.pool.display.sortOrder || a.id.localeCompare(b.id)
  ));
}

export function SetsPage() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const showLegacyNotice = searchParams.get("notice") === "legacy-redirect";

  const poolsQuery = useQuery({
    queryKey: setQueryKeys.list,
    queryFn: ({ signal }) => getPools(signal),
    staleTime: 60_000,
  });

  const tokenMetadata = useTokenMetadata();

  const sets = sortSets(
    (poolsQuery.data ?? []).map((pool) => toSetDefinition(pool, requiredChainId)),
  );
  const fingerprint = setDirectoryFingerprint(sets);
  const statesQuery = useQuery({
    queryKey: setQueryKeys.directory(fingerprint),
    enabled: poolsQuery.isSuccess && online,
    queryFn: () => loadSetDirectoryStates({
      definitions: sets,
      loadState: (poolId) => queryClient.fetchQuery({
        queryKey: setQueryKeys.state(poolId),
        queryFn: ({ signal }) => getPoolState(poolId, signal),
        staleTime: SET_STATE_REFRESH_INTERVAL_MS,
      }),
    }),
    refetchInterval: online ? SET_STATE_REFRESH_INTERVAL_MS : false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    staleTime: SET_STATE_REFRESH_INTERVAL_MS,
  });

  return (
    <div className="screen sets-screen">
      <header className="screen-header">
        <p className="eyebrow">Discover</p>
        <h1>Sets</h1>
        <p>Browse every Set available on this network. Each Set is backed by its own underlying liquidity pool.</p>
      </header>

      {showLegacyNotice && (
        <aside className="warning-panel" role="status">
          <strong>That link is no longer used.</strong>
          {" "}
          Choose a Set below. Deposit and withdraw now live on each Set's detail tabs.
        </aside>
      )}

      {!online && (
        <aside className="warning-panel" role="status">
          <strong>You are offline.</strong>
          {" "}Showing cached Set information where available. Live state refresh resumes when the connection returns.
        </aside>
      )}

      {poolsQuery.isPending && (
        <section className="prototype-card" aria-live="polite">Loading Sets…</section>
      )}

      {poolsQuery.error && (
        <section className="prototype-card error-panel" role="alert">
          <h2>Sets could not be loaded</h2>
          <p>{poolsQuery.error instanceof Error ? poolsQuery.error.message : "RFQ registry unavailable"}</p>
          <button className="secondary-button" type="button" onClick={() => void poolsQuery.refetch()}>
            Retry
          </button>
        </section>
      )}

      {!poolsQuery.isPending && !poolsQuery.error && sets.length === 0 && (
        <section className="empty-card">
          <div className="empty-mark" aria-hidden="true">S</div>
          <h2>No Sets yet</h2>
          <p>The RFQ registry did not return any Sets for this environment.</p>
        </section>
      )}

      {sets.length > 0 && (
        <section className="sets-directory" aria-label="Set directory">
          {sets.map((set) => (
            <SetDirectoryCard
              key={set.id}
              loading={online && statesQuery.isPending}
              onRetry={() => void statesQuery.refetch()}
              result={statesQuery.data?.find((result) => result.poolId === set.id)}
              set={set}
              tokenIndex={tokenMetadata.data}
            />
          ))}
        </section>
      )}
    </div>
  );
}
