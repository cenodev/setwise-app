import type { PortfolioView } from "./usePortfolio";
import {
  aggregateStatusLabel,
  derivePublicSummary,
  formatAggregateValue,
  formatUsd,
} from "./presentation";

type PortfolioPublicOverviewProps = {
  view: PortfolioView;
};

export function PortfolioPublicOverview({ view }: PortfolioPublicOverviewProps) {
  const summary = derivePublicSummary(view.sets);
  const freshnessLabel = view.freshness.status === "ready"
    ? "Fresh"
    : view.freshness.status === "stale"
      ? `${view.freshness.stale} stale`
      : view.freshness.status === "partial"
        ? "Partial coverage"
        : "Unavailable";

  return (
    <section className="portfolio-overview" aria-label="Setwise liquidity overview">
      <div className="portfolio-section-heading">
        <div>
          <p className="eyebrow">Protocol</p>
          <h2>Setwise liquidity</h2>
        </div>
        <span>{freshnessLabel} · {summary.coveredSets}/{summary.totalSets} Sets covered</span>
      </div>

      <div className="portfolio-summary">
        <article className="portfolio-metric-card">
          <p className="eyebrow">Setwise TVL</p>
          <strong>{formatAggregateValue(view.publicTvl)}</strong>
          <span>
            {aggregateStatusLabel(view.publicTvl.status)} · sum of Set reserves ·
            {" "}{view.publicTvl.coverage.available}/{view.publicTvl.coverage.total} Sets
          </span>
        </article>

        <article className="portfolio-metric-card">
          <p className="eyebrow">Set activity</p>
          <strong>{summary.activeSets} active</strong>
          <span>
            {summary.pausedSets} paused · {summary.constituentCount} unique constituents
          </span>
        </article>

        <article className="portfolio-metric-card portfolio-metric-card--external">
          <p className="eyebrow">External DEX liquidity</p>
          <strong>
            {view.externalLiquidity
              ? formatUsd(view.externalLiquidity.totalValueUsd)
              : "Unavailable"}
          </strong>
          <span>
            {view.externalLiquidity?.sources.length ?? 0} unique sources ·
            {" "}{view.externalLiquidityCoverage.available}/{view.externalLiquidityCoverage.total} Sets reported ·
            {" "}not included in Setwise TVL
          </span>
        </article>
      </div>

      <p className="portfolio-liquidity-note">
        Set reserves and Setwise TVL reflect each Set&apos;s underlying pool state.
        External DEX liquidity is deduplicated across venues and kept visually separate so it is never mistaken for Set TVL.
      </p>
    </section>
  );
}
