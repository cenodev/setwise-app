import { Link } from "react-router-dom";

import { setsPath } from "../app/routes";
import { useTokenMetadata } from "../data/tokens";
import { useOnlineStatus } from "../lib/useOnlineStatus";
import { PortfolioPublicOverview } from "../features/portfolio/PortfolioPublicOverview";
import { PortfolioSetPositionCard } from "../features/portfolio/PortfolioSetPositionCard";
import { PortfolioWalletSummary } from "../features/portfolio/PortfolioWalletSummary";
import { setHasNoUserLiquidity } from "../features/portfolio/presentation";
import { usePortfolio } from "../features/portfolio/usePortfolio";

export function PortfolioPage() {
  const portfolio = usePortfolio();
  const online = useOnlineStatus();
  const tokenMetadata = useTokenMetadata();
  const view = portfolio.view;
  const visibleSets = view?.sets.filter((set) => !setHasNoUserLiquidity(set)) ?? [];

  return (
    <div className="screen portfolio-screen">
      <header className="screen-header">
        <p className="eyebrow">Balances</p>
        <h1>Portfolio</h1>
        <p>
          Public Setwise liquidity and your attributed positions across every discovered Set.
          Set reserves, Setwise TVL, and external DEX liquidity are labelled separately.
        </p>
      </header>

      {!online && (
        <aside className="warning-panel" role="status">
          <strong>You are offline.</strong>
          {" "}Showing the last loaded Set portfolio until the connection returns.
        </aside>
      )}

      {portfolio.loading && !view && (
        <section className="prototype-card" aria-live="polite" aria-busy="true">
          Loading Set portfolio…
        </section>
      )}

      {portfolio.error && !view && (
        <section className="prototype-card error-panel" role="alert">
          <h2>Portfolio unavailable</h2>
          <p>{portfolio.error.message}</p>
          <button className="secondary-button" onClick={portfolio.retry} type="button">
            Retry
          </button>
        </section>
      )}

      {view && (
        <>
          {portfolio.refreshing && (
            <p className="portfolio-refreshing" role="status">Refreshing Set data…</p>
          )}

          {(view.publicTvl.status === "partial" || view.userLiquidity.status === "partial") && (
            <aside className="warning-panel" role="status">
              <strong>Partial portfolio.</strong>
              {" "}Available Set values remain visible while unavailable Sets are excluded from totals.
            </aside>
          )}

          {view.freshness.status === "stale" && (
            <aside className="warning-panel" role="status">
              <strong>Stale Set data.</strong>
              {" "}One or more snapshots are older than one minute.
            </aside>
          )}

          <PortfolioPublicOverview view={view} />
          <PortfolioWalletSummary view={view} />

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
                <div>
                  <p className="eyebrow">Coverage</p>
                  <h2>Set positions</h2>
                </div>
                <span>
                  {visibleSets.length} of {view.sets.length} Sets · {view.freshness.stale} stale ·
                  {" "}{view.publicTvl.coverage.errors} errors
                </span>
              </div>
              {visibleSets.length === 0 ? (
                <p className="portfolio-positions-empty" role="status">
                  No Set positions with attributed liquidity in this wallet yet.
                  Sets you deposit into will appear here.
                </p>
              ) : (
                visibleSets.map((set) => (
                  <PortfolioSetPositionCard
                    key={set.snapshot.definition.id}
                    publicTvl={view.publicTvl}
                    set={set}
                    tokenIndex={tokenMetadata.data}
                  />
                ))
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
