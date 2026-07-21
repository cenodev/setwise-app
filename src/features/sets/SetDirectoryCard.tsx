import { Link } from "react-router-dom";

import { setPath, swapPath } from "../../app/routes";
import { TokenIcon, tokenDisplay } from "../../components/TokenIdentity";
import type { SetDirectoryState } from "../../data/setDirectory";
import type { SetDefinition } from "../../data/sets";
import type { TokenMetadataIndex } from "../../data/tokens";
import { decimalRatio, formatDecimalRatio } from "../pool-analytics/model";

export const SET_STATE_REFRESH_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

type SetDirectoryCardProps = {
  loading: boolean;
  onRetry: () => void;
  result: SetDirectoryState | undefined;
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

export function SetDirectoryCard({ loading, onRetry, result, set, tokenIndex }: SetDirectoryCardProps) {
  const state = result?.status === "ready" ? result.state : undefined;
  const error = result?.status === "error" ? result.error : undefined;
  const stale = state ? isStaleSnapshot(state.blockTimestamp) : false;
  const tradingPaused = state?.trading.paused ?? false;
  const displayName = set.pool.display.name;

  return (
    <article className="set-directory-card" aria-label={displayName}>
      <div className="set-directory-header">
        <div>
          <p className="eyebrow">
            {set.pool.display.category ?? "Set"}
          </p>
          <h2>{displayName}</h2>
          <p className="set-directory-chain">
            {set.supported
              ? (set.chainName ?? `Chain ${set.chainId}`)
              : `Unsupported · ${set.chainName ?? `chain ${set.chainId}`}`}
          </p>
          <p className="set-directory-description">{set.pool.display.description}</p>
          <code className="set-directory-id">{set.id}</code>
        </div>
        {state && (
          <span
            className={`set-status ${tradingPaused ? "set-status--paused" : stale ? "set-status--stale" : "set-status--active"}`}
          >
            {tradingPaused ? "Paused" : stale ? "Stale" : "Trading"}
          </span>
        )}
      </div>

      <ul className="set-directory-assets" aria-label={`${displayName} constituents`}>
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
          {loading && !result && (
            <p className="set-directory-state__pending">Loading live state…</p>
          )}
          {error && (
            <p className="set-directory-state__error" role="alert">
              Live state unavailable: {error.message}
              <button
                className="inline-action"
                type="button"
                onClick={onRetry}
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
        TVL and reserves reflect the Set&apos;s underlying pool state, not external DEX liquidity.
      </p>
    </article>
  );
}
