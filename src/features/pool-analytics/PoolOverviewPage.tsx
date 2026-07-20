import { useMemo } from "react";

import type { Pool, PoolAsset, PoolState } from "../../data/rfq/deposits";
import {
  calculateCurrentAssetAllocation,
  calculateLpSharePrice,
  calculateMidpointMarketPrice,
  calculatePoolTvl,
  calculateTargetAllocationVariance,
  decimalRatio,
  formatDecimalRatio,
  type Calculation,
} from "./model";

type LiquidityRow = {
  asset: PoolAsset;
  state: PoolState["assets"][number];
};

export type PoolOverviewPageProps = {
  error: Error | null;
  loading: boolean;
  onRetry: () => void;
  online: boolean;
  pool: Pool | undefined;
  refreshing: boolean;
  state: PoolState | undefined;
};

function trimTrailingZeros(value: string): string {
  return value.includes(".") ? value.replace(/(?:\.0+|(?<=[0-9])0+)$/, "") : value;
}

function formatTokenAmount(value: string, maximumFractionDigits = 6): string {
  return trimTrailingZeros(formatDecimalRatio(decimalRatio(value), maximumFractionDigits));
}

function formatUsd(value: ReturnType<typeof calculatePoolTvl>, fractionDigits = 2): string {
  return `$${formatDecimalRatio(value, fractionDigits)}`;
}

function formatCalculation(value: Calculation, fractionDigits: number, suffix = ""): string {
  return value.status === "available" ? `${formatDecimalRatio(value.value, fractionDigits)}${suffix}` : "Unavailable";
}

function formatSignedCalculation(value: Calculation): string {
  if (value.status === "unavailable") return "Unavailable";
  const formatted = formatDecimalRatio(value.value, 2);
  return `${value.value.numerator > 0n ? "+" : ""}${formatted} pp`;
}

function formatPoolTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) return "Unknown timestamp";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(timestamp) + " UTC";
}

function orderedLiquidityRows(pool: Pool, state: PoolState): LiquidityRow[] | undefined {
  const stateByAsset = new Map(state.assets.map((asset) => [asset.asset, asset]));
  const assets = [...pool.assets].sort((left, right) => left.index - right.index);
  const rows = assets.map((asset) => {
    const assetState = stateByAsset.get(asset.id);
    return assetState ? { asset, state: assetState } : undefined;
  });
  return rows.some((row) => !row) || stateByAsset.size !== assets.length
    ? undefined
    : rows as LiquidityRow[];
}

function healthLabel(status: PoolState["assets"][number]["balanceStatus"]): string {
  return status === "synced" ? "Healthy" : status[0].toUpperCase() + status.slice(1);
}

export function PoolOverviewPage({
  error,
  loading,
  onRetry,
  online,
  pool,
  refreshing,
  state,
}: PoolOverviewPageProps) {
  const rows = useMemo(
    () => pool && state ? orderedLiquidityRows(pool, state) : undefined,
    [pool, state],
  );
  const snapshotMismatch = pool && state && (
    pool.id !== state.poolId
    || pool.chain.id !== state.chainId
    || pool.contract.address.toLowerCase() !== state.poolAddress.toLowerCase()
    || !rows
  );

  if (!online && (!pool || !state)) {
    return (
      <section className="pool-card pool-status-card warning-panel" role="status">
        <strong>No saved pool snapshot is available offline.</strong>
        <span>Reconnect to load public pool reserves and wallet estimates.</span>
      </section>
    );
  }
  if (loading && (!pool || !state)) {
    return <section className="pool-card pool-status-card" aria-live="polite">Loading public pool overview…</section>;
  }
  if (!pool || !state || snapshotMismatch) {
    return (
      <section className="pool-card pool-status-card error-panel" role="alert">
        <strong>Couldn’t load a consistent public pool snapshot.</strong>
        <span>{error instanceof Error ? error.message : "The pool discovery and state data do not match."}</span>
        <button className="inline-action" disabled={!online} onClick={onRetry} type="button">Retry</button>
      </section>
    );
  }
  if (!rows?.length) {
    return (
      <section className="pool-card pool-status-card empty-card">
        <div className="empty-mark" aria-hidden="true">$</div>
        <h2>No public pool data yet</h2>
        <p>Liquidity metrics will appear when the pool publishes its first snapshot.</p>
      </section>
    );
  }

  const lpPrice = calculateLpSharePrice(state);
  const driftedAssets = rows.filter(({ state: assetState }) => assetState.balanceStatus === "drifted");

  return (
    <div className="pool-overview">
      {refreshing && <p className="pool-refreshing" role="status">Refreshing live pool data…</p>}
      {driftedAssets.length > 0 && (
        <aside className="warning-panel" role="alert">
          <strong>Reserve balance drift detected.</strong> The table shows the server-provided usable balances for {driftedAssets.map(({ asset }) => asset.symbol).join(", ")}.
        </aside>
      )}
      <section className="pool-card" aria-labelledby="pool-metrics-title">
        <div className="pool-section-heading">
          <div><p className="eyebrow">Public pool</p><h2 id="pool-metrics-title">Pool metrics</h2></div>
          <p>Updated {formatPoolTimestamp(state.blockTimestamp)} · Block {state.blockNumber}</p>
        </div>
        <dl className="pool-metrics">
          <div><dt>Total value locked</dt><dd>{formatUsd(calculatePoolTvl(state))}</dd></div>
          <div><dt>Total LP supply</dt><dd>{formatTokenAmount(state.totalSupply.amount)} <span>{pool.lpToken.symbol}</span></dd></div>
          <div><dt>Implied LP share price</dt><dd>{lpPrice.status === "available" ? `$${formatDecimalRatio(lpPrice.value, 4)} USD` : "Unavailable"}</dd></div>
        </dl>
      </section>
      <section className="pool-card" aria-labelledby="pool-liquidity-title">
        <div className="pool-section-heading">
          <div><p className="eyebrow">Reserve composition</p><h2 id="pool-liquidity-title">Pool liquidity</h2></div>
          <p>Balances and reserve values are supplied by the pool server.</p>
        </div>
        <div className="pool-table-scroll">
          <table className="pool-table">
            <thead><tr><th scope="col">Asset</th><th scope="col">Usable balance</th><th scope="col">Midpoint price</th><th scope="col">Reserve value</th><th scope="col">Current</th><th scope="col">Target</th><th scope="col">Variance</th><th scope="col">Health</th></tr></thead>
            <tbody>{rows.map(({ asset, state: assetState }) => {
              const current = calculateCurrentAssetAllocation(assetState, state);
              const variance = calculateTargetAllocationVariance(assetState, state, asset.weight);
              return <tr key={asset.id}>
                <th scope="row"><span>{asset.name ?? asset.symbol}</span><small>{asset.symbol}</small></th>
                <td>{formatTokenAmount(assetState.amount)} {asset.symbol}</td>
                <td>{formatUsd(calculateMidpointMarketPrice(assetState.market), 4)}</td>
                <td>{formatUsd(decimalRatio(assetState.valueUsd))}</td>
                <td>{formatCalculation(current.status === "available" ? { status: "available", value: { numerator: current.value.numerator * 100n, denominator: current.value.denominator } } : current, 2, "%")}</td>
                <td>{asset.weight}%</td>
                <td className={variance.status === "available" && variance.value.numerator !== 0n ? "pool-variance" : undefined}>{formatSignedCalculation(variance)}</td>
                <td><span className={`pool-health pool-health--${assetState.balanceStatus}`}>{healthLabel(assetState.balanceStatus)}</span></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
