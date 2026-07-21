import { Link } from "react-router-dom";

import { setPath, setsPath } from "../app/routes";
import { decimalRatio, formatDecimalRatio, type DecimalRatio } from "../features/pool-analytics/model";
import {
  calculateSetSharePercentage,
  calculateUserSetLiquidity,
  type PortfolioAggregate,
} from "../features/portfolio/model";
import { usePortfolio, type PortfolioSetView } from "../features/portfolio/usePortfolio";

function formatUsd(value: DecimalRatio): string {
  return `$${formatDecimalRatio(value, 2)}`;
}

function aggregateValue(aggregate: PortfolioAggregate, disconnectedLabel = "Connect wallet"): string {
  if (aggregate.status === "disconnected") return disconnectedLabel;
  if ("value" in aggregate) return formatUsd(aggregate.value);
  return "Unavailable";
}

function statusLabel(status: PortfolioAggregate["status"]): string {
  switch (status) {
    case "ready": return "Live";
    case "partial": return "Partial";
    case "stale": return "Stale";
    case "zero-balance": return "Zero balance";
    case "disconnected": return "Disconnected";
    case "unsupported-chain": return "Unsupported chain";
    case "error": return "Unavailable";
  }
}

function setPublicValue(set: PortfolioSetView): string {
  const { snapshot } = set;
  return snapshot.status === "ready" || snapshot.status === "stale"
    ? formatUsd(decimalRatio(snapshot.state.totalValueUsd))
    : "Unavailable";
}

function setUserValue(set: PortfolioSetView): string {
  const { snapshot, wallet } = set;
  if (!wallet) return "Unavailable";
  if (wallet.status === "disconnected") return "Connect wallet";
  if (!("position" in wallet) || (snapshot.status !== "ready" && snapshot.status !== "stale")) {
    return "Unavailable";
  }
  const value = calculateUserSetLiquidity({
    attributedSharesAtomic: wallet.position.shares.totalAttributed,
    state: snapshot.state,
  });
  return value.status === "available" ? formatUsd(value.value) : "Unavailable";
}

function setShare(set: PortfolioSetView, total: PortfolioAggregate): string {
  if (!("value" in total)) return "Unavailable";
  const { snapshot } = set;
  if (snapshot.status !== "ready" && snapshot.status !== "stale") return "Unavailable";
  const result = calculateSetSharePercentage(decimalRatio(snapshot.state.totalValueUsd), total.value);
  return result.status === "available" ? `${formatDecimalRatio(result.value, 2)}%` : "Unavailable";
}

function setStatus(set: PortfolioSetView): string {
  if (set.snapshot.status === "unsupported-chain") return "Unsupported chain";
  if (set.snapshot.status === "error") return "Public data unavailable";
  if (set.wallet?.status === "error") return "Wallet data unavailable";
  if (set.snapshot.status === "stale" || set.wallet?.status === "stale") return "Stale snapshot";
  if (set.wallet?.status === "zero-balance") return "Zero balance";
  if (set.wallet?.status === "disconnected") return "Wallet disconnected";
  return "Ready";
}

export function PortfolioPage() {
  const portfolio = usePortfolio();
  const view = portfolio.view;

  return (
    <div className="screen portfolio-screen">
      <header className="screen-header">
        <p className="eyebrow">Balances</p>
        <h1>Portfolio</h1>
        <p>Public Setwise liquidity and your attributed positions across every discovered Set.</p>
      </header>

      {portfolio.loading && !view && (
        <section className="prototype-card" aria-live="polite">Loading Set portfolio…</section>
      )}

      {portfolio.error && !view && (
        <section className="prototype-card error-panel" role="alert">
          <h2>Portfolio unavailable</h2>
          <p>{portfolio.error.message}</p>
          <button className="secondary-button" onClick={portfolio.retry} type="button">Retry</button>
        </section>
      )}

      {view && (
        <>
          {portfolio.refreshing && <p className="portfolio-refreshing" role="status">Refreshing Set data…</p>}
          {(view.publicTvl.status === "partial" || view.userLiquidity.status === "partial") && (
            <aside className="warning-panel" role="status">
              <strong>Partial portfolio.</strong> Available Set values remain visible while unavailable Sets are excluded.
            </aside>
          )}
          {view.freshness.status === "stale" && (
            <aside className="warning-panel" role="status">
              <strong>Stale Set data.</strong> One or more snapshots are older than one minute.
            </aside>
          )}

          <section className="portfolio-summary" aria-label="Portfolio totals">
            <article className="portfolio-metric-card">
              <p className="eyebrow">Setwise liquidity</p>
              <strong>{aggregateValue(view.publicTvl)}</strong>
              <span>{statusLabel(view.publicTvl.status)} · {view.publicTvl.coverage.available}/{view.publicTvl.coverage.total} Sets covered</span>
            </article>
            <article className="portfolio-metric-card">
              <p className="eyebrow">Your Set liquidity</p>
              <strong>{view.walletLoading ? "Loading…" : aggregateValue(view.userLiquidity)}</strong>
              <span>{statusLabel(view.userLiquidity.status)} · unlocked and locked shares</span>
            </article>
            <article className="portfolio-metric-card">
              <p className="eyebrow">External DEX liquidity</p>
              <strong>{view.externalLiquidity ? formatUsd(view.externalLiquidity.totalValueUsd) : "Unavailable"}</strong>
              <span>
                {view.externalLiquidity?.sources.length ?? 0} unique sources · {view.externalLiquidityCoverage.available}/{view.externalLiquidityCoverage.total} Sets reported · separate from Set reserves
              </span>
            </article>
          </section>

          {view.sets.length === 0 ? (
            <section className="empty-card">
              <div className="empty-mark" aria-hidden="true">S</div>
              <h2>No Sets yet</h2>
              <p>The registry did not return any Sets for this environment.</p>
              <Link className="secondary-link" to={setsPath()}>Browse Sets</Link>
            </section>
          ) : (
            <section className="portfolio-sets" aria-label="Set positions">
              <div className="portfolio-section-heading">
                <div><p className="eyebrow">Coverage</p><h2>Set positions</h2></div>
                <span>{view.freshness.stale} stale · {view.publicTvl.coverage.errors} errors</span>
              </div>
              {view.sets.map((set) => {
                const { definition } = set.snapshot;
                const hasState = set.snapshot.status === "ready" || set.snapshot.status === "stale";
                return (
                  <article className="portfolio-set-card" key={definition.id}>
                    <div className="portfolio-set-heading">
                      <div>
                        <p className="eyebrow">{definition.chainName ?? `Chain ${definition.chainId}`}</p>
                        <h3>{definition.id}</h3>
                      </div>
                      <span className={`portfolio-status portfolio-status--${set.snapshot.status}`}>{setStatus(set)}</span>
                    </div>
                    <dl className="portfolio-set-metrics">
                      <div><dt>Set liquidity</dt><dd>{setPublicValue(set)}</dd></div>
                      <div><dt>Your liquidity</dt><dd>{setUserValue(set)}</dd></div>
                      <div><dt>Share of Setwise</dt><dd>{setShare(set, view.publicTvl)}</dd></div>
                    </dl>
                    <div className="portfolio-set-footer">
                      <span>{hasState ? `Snapshot block ${set.snapshot.state.blockNumber}` : "No usable snapshot"}</span>
                      <Link className="secondary-link" to={setPath(definition.id, "overview")}>View Set</Link>
                    </div>
                  </article>
                );
              })}
            </section>
          )}
        </>
      )}
    </div>
  );
}
