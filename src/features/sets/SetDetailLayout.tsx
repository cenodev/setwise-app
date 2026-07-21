import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Navigate, Outlet, useParams } from "react-router-dom";

import { SET_TABS, setPath, setsPath } from "../../app/routes";
import { requiredChainId } from "../../config/chains";
import { runtimeConfig } from "../../config/env";
import { setQueryKeys } from "../../data/queryKeys";
import { getPool, getPoolState, type Pool, type PoolState } from "../../data/rfq/deposits";
import { getPools } from "../../data/rfq/pools";
import {
  resolveSet,
  validateSetSnapshot,
  type SetDefinition,
} from "../../data/sets";
import { useOnlineStatus } from "../../lib/useOnlineStatus";
import { POOL_STATE_REFRESH_INTERVAL_MS } from "../pool-analytics/PoolPage";

export type SetOutletContext = {
  definition: SetDefinition;
  error: Error | null;
  loading: boolean;
  operationUnavailable: {
    deposit: string | null;
    withdraw: string | null;
  };
  pool: Pool | undefined;
  poolState: PoolState | undefined;
  refreshing: boolean;
  retry: () => void;
  unsupported: boolean;
};

function formatSnapshotTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(timestamp) + " UTC";
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function SetDetailLayout() {
  const { setId: rawSetId } = useParams<{ setId: string }>();
  const setId = rawSetId ? decodeURIComponent(rawSetId) : "";
  const online = useOnlineStatus();

  const poolsQuery = useQuery({
    queryKey: setQueryKeys.list,
    queryFn: ({ signal }) => getPools(signal),
    staleTime: 60_000,
  });
  const resolution = resolveSet(setId, poolsQuery.data, requiredChainId);
  const definition = resolution.status === "ready" || resolution.status === "unsupported-chain"
    ? resolution.definition
    : undefined;
  const canLoadSnapshot = Boolean(setId && definition);

  const poolQuery = useQuery({
    queryKey: setQueryKeys.detail(setId),
    queryFn: ({ signal }) => getPool(setId, signal),
    enabled: canLoadSnapshot,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
  const poolStateQuery = useQuery({
    queryKey: setQueryKeys.state(setId),
    queryFn: ({ signal }) => getPoolState(setId, signal),
    enabled: canLoadSnapshot,
    refetchInterval: online && canLoadSnapshot ? POOL_STATE_REFRESH_INTERVAL_MS : false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    staleTime: POOL_STATE_REFRESH_INTERVAL_MS,
  });

  if (!setId) {
    return <Navigate to={setsPath()} replace />;
  }

  if (resolution.status === "loading" || poolsQuery.isPending) {
    return (
      <div className="screen set-detail-screen">
        <section className="prototype-card" aria-live="polite">Loading Set…</section>
      </div>
    );
  }

  if (poolsQuery.error && !poolsQuery.data) {
    return (
      <div className="screen set-detail-screen">
        <section className="prototype-card error-panel" role="alert">
          <h1>Set unavailable</h1>
          <p>{poolsQuery.error instanceof Error ? poolsQuery.error.message : "RFQ registry unavailable"}</p>
          <button className="secondary-button" type="button" onClick={() => void poolsQuery.refetch()}>
            Retry
          </button>
          <Link className="secondary-link" to={setsPath()}>Back to Sets</Link>
        </section>
      </div>
    );
  }

  if (resolution.status === "not-found") {
    return (
      <div className="screen set-detail-screen">
        <section className="empty-card" role="alert">
          <div className="empty-mark" aria-hidden="true">?</div>
          <h1>Unknown Set</h1>
          <p>
            No Set with id <code>{resolution.poolId}</code> appears in the RFQ registry.
          </p>
          <Link className="secondary-link" to={setsPath()}>Browse Sets</Link>
        </section>
      </div>
    );
  }

  if (resolution.status === "error" || !definition) {
    return (
      <div className="screen set-detail-screen">
        <section className="prototype-card error-panel" role="alert">
          <h1>Set unavailable</h1>
          <p>{resolution.status === "error" ? resolution.error.message : "The Set definition is unavailable."}</p>
          <Link className="secondary-link" to={setsPath()}>Back to Sets</Link>
        </section>
      </div>
    );
  }

  const unsupported = resolution.status === "unsupported-chain";
  const mismatch = poolQuery.data && poolStateQuery.data
    ? validateSetSnapshot(setId, definition, poolQuery.data, poolStateQuery.data)
    : null;
  const error = mismatch ?? poolQuery.error ?? poolStateQuery.error;
  const consistentPool = mismatch ? undefined : poolQuery.data;
  const consistentState = mismatch ? undefined : poolStateQuery.data;
  const hasSnapshot = Boolean(consistentPool && consistentState);
  const loading = !hasSnapshot && (poolQuery.isPending || poolStateQuery.isPending);
  const refreshing = hasSnapshot && (poolQuery.isFetching || poolStateQuery.isFetching);
  const paused = Boolean(consistentState?.trading.paused);
  const retry = () => {
    void poolQuery.refetch();
    void poolStateQuery.refetch();
  };

  let globalOperationUnavailable: string | null = null;
  if (unsupported) {
    globalOperationUnavailable = "Transactions are unavailable because this Set is on an unsupported chain.";
  } else if (paused) {
    globalOperationUnavailable = "Transactions are unavailable while this Set is paused.";
  } else if (!hasSnapshot) {
    globalOperationUnavailable = error
      ? "Transactions are unavailable until a consistent live Set snapshot can be loaded."
      : "Transactions will be available after the live Set snapshot finishes loading.";
  }
  const depositUnavailable = globalOperationUnavailable
    ?? (consistentState?.trading.deposits === "paused" ? "Deposits are paused for this Set." : null);

  const status = unsupported
    ? { className: "set-status--unsupported", label: "Unsupported chain" }
    : paused
      ? { className: "set-status--paused", label: "Paused" }
      : hasSnapshot
        ? { className: "set-status--active", label: "Active" }
        : error
          ? { className: "set-status--unavailable", label: "Unavailable" }
          : { className: "set-status--loading", label: "Checking status" };
  const explorerUrl = definition.supported
    ? `${runtimeConfig.explorerUrl}/address/${definition.pool.contract.address}`
    : null;
  const orderedAssets = [...definition.pool.assets].sort((left, right) => left.index - right.index);

  const outletContext: SetOutletContext = {
    definition,
    error: error instanceof Error ? error : error ? new Error("Set data is unavailable") : null,
    loading,
    operationUnavailable: {
      deposit: depositUnavailable,
      withdraw: globalOperationUnavailable,
    },
    pool: consistentPool,
    poolState: consistentState,
    refreshing,
    retry,
    unsupported,
  };

  return (
    <div className="screen set-detail-screen">
      <header className="set-detail-header">
        <div className="set-detail-heading">
          <div>
            <p className="eyebrow">{definition.pool.display.category ?? "Set"}</p>
            <h1>{definition.pool.display.name}</h1>
            <p>{definition.pool.display.description}</p>
          </div>
          <span className={`set-status ${status.className}`} role="status">{status.label}</span>
        </div>

        <dl className="set-detail-metadata">
          <div><dt>Chain</dt><dd>{definition.chainName ?? `Chain ${definition.chainId}`}</dd></div>
          <div>
            <dt>Contract</dt>
            <dd>
              {explorerUrl
                ? (
                  <a href={explorerUrl} target="_blank" rel="noreferrer" aria-label={`View Set contract ${definition.pool.contract.address} in explorer`}>
                    {shortenAddress(definition.pool.contract.address)} <span aria-hidden="true">↗</span>
                  </a>
                )
                : <code title={definition.pool.contract.address}>{shortenAddress(definition.pool.contract.address)}</code>}
            </dd>
          </div>
          <div><dt>Last update</dt><dd>{consistentState ? formatSnapshotTimestamp(consistentState.blockTimestamp) : "Awaiting live snapshot"}</dd></div>
        </dl>

        <div className="set-constituents" aria-labelledby="set-constituents-title">
          <span id="set-constituents-title">Constituents</span>
          <ul>
            {orderedAssets.map((asset) => <li key={asset.id}>{asset.symbol} <span>{asset.weight}%</span></li>)}
          </ul>
        </div>
      </header>

      {unsupported && (
        <aside className="warning-panel" role="status">
          <strong>Unsupported chain.</strong>
          {" "}
          Public Set data remains visible. Wallet reads, deposits, and withdrawals stay disabled until this chain is supported.
        </aside>
      )}
      {paused && (
        <aside className="warning-panel" role="alert">
          <strong>This Set is paused.</strong> Public data remains visible, but transactions are disabled.
        </aside>
      )}
      {poolsQuery.error && poolsQuery.data && (
        <aside className="warning-panel" role="status">
          <strong>Set registry refresh failed.</strong> The last validated definition remains visible.
        </aside>
      )}
      {mismatch && (
        <aside className="error-panel" role="alert">
          <strong>Set data mismatch.</strong> {mismatch.message} No live data or actions are being shown.
        </aside>
      )}

      <nav className="set-tabs" aria-label="Set sections">
        {SET_TABS.map(({ label, tab }) => (
          <NavLink
            key={tab}
            to={setPath(definition.id, tab)}
            className={({ isActive }) => (isActive ? "set-tab is-active" : "set-tab")}
            end
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={outletContext} />
    </div>
  );
}
