import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { setPath, swapPath } from "../../app/routes";
import { TokenIcon, tokenDisplay } from "../../components/TokenIdentity";
import { setQueryKeys } from "../../data/queryKeys";
import { getPoolState } from "../../data/rfq/deposits";
import type { SetDefinition } from "../../data/sets";
import type { TokenMetadataIndex } from "../../data/tokens";
import { useOnlineStatus } from "../../lib/useOnlineStatus";
import { decimalRatio, formatDecimalRatio } from "../pool-analytics/model";

export const SET_STATE_REFRESH_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

type SetDirectoryCardProps = {
  set: SetDefinition;
  tokenIndex: TokenMetadataIndex | undefined;
};

function formatSnapshotTime(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(timestamp) + " UTC";
}

function formatTvl(value: string): string {
  return `$${formatDecimalRatio(decimalRatio(value), 2)}`;
}

export function isStaleSnapshot(timestamp: string, now: number = Date.now()): boolean {
  const snapshot = new Date(timestamp);
  if (Number.isNaN(snapshot.valueOf())) return true;
  return now - snapshot.getTime() > STALE_THRESHOLD_MS;
}

export function SetDirectoryCard({ set, tokenIndex }: SetDirectoryCardProps) {
  const online = useOnlineStatus();
  const stateQuery = useQuery({
    queryKey: setQueryKeys.state(set.id),
    queryFn: ({ signal }) => getPoolState(set.id, signal),
    enabled: set.supported,
    staleTime: SET_STATE_REFRESH_INTERVAL_MS,
    refetchInterval: online ? SET_STATE_REFRESH_INTERVAL_MS : false,
    refetchOnReconnect: true,
  });

  const state = stateQuery.data;
  const stale = state ? isStaleSnapshot(state.blockTimestamp) : false;
  const tradingPaused = state?.trading.paused ?? false;

  return (
    <article className="set-directory-card" aria-label={`Set ${set.id}`}>
      <div className="set-directory-header">
        <div>
          <p className="eyebrow">
            {set.supported ? (set.chainName ?? "Supported chain") : "Unsupported chain"}
          </p>
          <h2>{set.id}</h2>
        </div>
        {state && (
          <span
            className={`set-status ${tradingPaused ? "set-status--paused" : stale ? "set-status--stale" : "set-status--active"}`}
          >
            {tradingPaused ? "Paused" : stale ? "Stale" : "Trading"}
          </span>
        )}
      </div>

      <ul className="set-directory-assets" aria-label={`${set.id} constituents`}>
        {set.pool.assets.map((asset) => {
          const display = tokenDisplay(asset, set.chainId, tokenIndex);
          return (
            <li key={asset.id} className="set-directory-asset">
              <TokenIcon logoURI={display.logoURI} symbol={display.symbol} />
              <span className="set-directory-asset__label">
                <strong>{display.symbol}</strong>
                <small>{asset.weight}%</small>
              </span>
            </li>
          );
        })}
      </ul>

      {set.supported && (
        <div className="set-directory-state" aria-live="polite">
          {stateQuery.isPending && (
            <p className="set-directory-state__pending">Loading live state…</p>
          )}
          {stateQuery.error && (
            <p className="set-directory-state__error" role="alert">
              Live state unavailable
              <button
                className="inline-action"
                type="button"
                onClick={() => void stateQuery.refetch()}
              >
                Retry
              </button>
            </p>
          )}
          {state && (
            <dl className="set-directory-metrics">
              <div>
                <dt>Set TVL</dt>
                <dd>{formatTvl(state.totalValueUsd)}</dd>
              </div>
              <div>
                <dt>Snapshot</dt>
                <dd>{formatSnapshotTime(state.blockTimestamp)}</dd>
              </div>
            </dl>
          )}
        </div>
      )}

      {!set.supported && (
        <p className="set-directory-unsupported">
          This Set runs on {set.chainName ?? `chain ${set.chainId}`}, which is not supported in this environment.
        </p>
      )}

      <div className="set-directory-actions">
        <Link className="secondary-link" to={setPath(set.id, "overview")}>
          View Set
        </Link>
        {set.supported && (
          <Link className="secondary-link" to={swapPath(set.id)}>
            Swap
          </Link>
        )}
      </div>

      <p className="set-directory-note">
        TVL and reserves reflect internal Set pool state, not external DEX liquidity.
      </p>
    </article>
  );
}
