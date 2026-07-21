import { Link } from "react-router-dom";

import { setPath } from "../../app/routes";
import { TokenIcon, tokenDisplay } from "../../components/TokenIdentity";
import type { TokenMetadataIndex } from "../../data/tokens";
import type { PortfolioAggregate } from "./model";
import type { PortfolioSetView } from "./usePortfolio";
import {
  setLockClaimStatus,
  setLpShares,
  setOwnership,
  setPositionStatus,
  setPublicLiquidity,
  setShareOfProtocol,
  setUserLiquidity,
} from "./presentation";

type PortfolioSetPositionCardProps = {
  publicTvl: PortfolioAggregate;
  set: PortfolioSetView;
  tokenIndex: TokenMetadataIndex | undefined;
};

export function PortfolioSetPositionCard({
  publicTvl,
  set,
  tokenIndex,
}: PortfolioSetPositionCardProps) {
  const { definition } = set.snapshot;
  const displayName = definition.pool.display.name;
  const hasState = set.snapshot.status === "ready" || set.snapshot.status === "stale";
  const status = setPositionStatus(set);
  const statusClass = set.snapshot.status === "error" || set.wallet?.status === "error"
    ? "error"
    : set.snapshot.status === "stale"
      || set.wallet?.status === "stale"
      || set.snapshot.status === "unsupported-chain"
      ? set.snapshot.status === "unsupported-chain"
        ? "unsupported-chain"
        : "stale"
      : set.snapshot.status === "ready" && set.snapshot.state.trading.paused
        ? "paused"
        : "ready";

  return (
    <article className="portfolio-set-card" aria-label={`${displayName} position`}>
      <div className="portfolio-set-heading">
        <div>
          <p className="eyebrow">
            {definition.supported
              ? (definition.chainName ?? `Chain ${definition.chainId}`)
              : "Unsupported chain"}
          </p>
          <h3>{displayName}</h3>
          <code>{definition.id}</code>
        </div>
        <span className={`portfolio-status portfolio-status--${statusClass}`}>{status}</span>
      </div>

      <ul className="portfolio-set-assets" aria-label={`${displayName} constituents`}>
        {definition.pool.assets.map((asset) => {
          const display = tokenDisplay(asset, definition.chainId, tokenIndex);
          return (
            <li key={asset.id} className="portfolio-set-asset">
              <TokenIcon logoURI={display.logoURI} symbol={display.symbol} />
              <span className="portfolio-set-asset__label">
                <strong>{display.symbol}</strong>
                <small>{asset.weight}%</small>
              </span>
            </li>
          );
        })}
      </ul>

      <dl className="portfolio-set-metrics">
        <div>
          <dt>Set reserves (TVL)</dt>
          <dd>{setPublicLiquidity(set)}</dd>
        </div>
        <div>
          <dt>Your liquidity</dt>
          <dd>{setUserLiquidity(set)}</dd>
        </div>
        <div>
          <dt>Ownership</dt>
          <dd>{setOwnership(set)}</dd>
        </div>
        <div>
          <dt>LP shares</dt>
          <dd>{setLpShares(set)}</dd>
        </div>
        <div>
          <dt>Share of Setwise</dt>
          <dd>{setShareOfProtocol(set, publicTvl)}</dd>
        </div>
        <div>
          <dt>Lock / claim</dt>
          <dd>{setLockClaimStatus(set)}</dd>
        </div>
      </dl>

      <div className="portfolio-set-footer">
        <span>
          {hasState
            ? `Snapshot block ${set.snapshot.state.blockNumber}`
            : "No usable snapshot"}
        </span>
        <nav className="portfolio-set-actions" aria-label={`${displayName} actions`}>
          <Link className="secondary-link" to={setPath(definition.id, "overview")}>
            Overview
          </Link>
          {definition.supported && (
            <>
              <Link className="secondary-link" to={setPath(definition.id, "deposit")}>
                Deposit
              </Link>
              <Link className="secondary-link" to={setPath(definition.id, "withdraw")}>
                Withdraw
              </Link>
            </>
          )}
        </nav>
      </div>
    </article>
  );
}
