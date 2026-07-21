import { useAppKit } from "@reown/appkit/react";
import { Link } from "react-router-dom";

import { setsPath } from "../../app/routes";
import { runtimeConfig } from "../../config/env";
import type { PortfolioView } from "./usePortfolio";
import {
  aggregateStatusLabel,
  deriveWalletSummary,
  formatAggregateValue,
  formatUsd,
} from "./presentation";

type PortfolioWalletSummaryProps = {
  view: PortfolioView;
};

function ConnectAction() {
  const { open } = useAppKit();
  return (
    <button
      className="primary-button"
      type="button"
      onClick={() => void open({ view: "Connect" })}
    >
      Connect wallet
    </button>
  );
}

export function PortfolioWalletSummary({ view }: PortfolioWalletSummaryProps) {
  const disconnected = view.userLiquidity.status === "disconnected";
  const stats = deriveWalletSummary(view.sets);
  const shareBreakdownPartial = stats.unlockedPartial || stats.lockedPartial;

  if (disconnected) {
    return (
      <section className="portfolio-wallet-panel" aria-labelledby="portfolio-wallet-connect-title">
        <div className="portfolio-section-heading">
          <div>
            <p className="eyebrow">Your positions</p>
            <h2 id="portfolio-wallet-connect-title">Connect to see your Set liquidity</h2>
          </div>
        </div>
        <p>
          Public Setwise liquidity stays visible above. Connect a wallet to load attributed LP shares,
          ownership, and lock status across every discovered Set.
        </p>
        {runtimeConfig.walletConfigured ? (
          <ConnectAction />
        ) : (
          <p className="portfolio-wallet-setup" role="status">
            Wallet setup required — set <code>VITE_REOWN_PROJECT_ID</code> to enable connections.
          </p>
        )}
      </section>
    );
  }

  const zeroOwned = !view.walletLoading
    && view.userLiquidity.status === "zero-balance"
    && stats.ownedSets === 0;

  return (
    <section className="portfolio-wallet-panel" aria-label="Your Set liquidity">
      <div className="portfolio-section-heading">
        <div>
          <p className="eyebrow">Your positions</p>
          <h2>Your Set liquidity</h2>
        </div>
        <span>
          {view.walletLoading
            ? "Loading wallet…"
            : `${aggregateStatusLabel(view.userLiquidity.status)} · ${stats.ownedSets} owned Sets`}
        </span>
      </div>

      {(view.userLiquidity.status === "partial" || shareBreakdownPartial) && (
        <aside className="warning-panel" role="status">
          <strong>Partial valuation.</strong>
          {" "}Unavailable Sets are excluded from totals and never treated as zero.
        </aside>
      )}

      <div className="portfolio-summary portfolio-summary--wallet">
        <article className="portfolio-metric-card">
          <p className="eyebrow">Total liquidity</p>
          <strong>{view.walletLoading ? "Loading…" : formatAggregateValue(view.userLiquidity)}</strong>
          <span>Unlocked and locked attributed shares</span>
        </article>
        <article className="portfolio-metric-card">
          <p className="eyebrow">Unlocked value</p>
          <strong>
            {view.walletLoading
              ? "Loading…"
              : stats.unlockedValue === undefined
                ? "Unavailable"
                : formatUsd(stats.unlockedValue)}
          </strong>
          <span>{stats.unlockedPartial ? "Partial · available Sets only" : "Estimated USD"}</span>
        </article>
        <article className="portfolio-metric-card">
          <p className="eyebrow">Locked value</p>
          <strong>
            {view.walletLoading
              ? "Loading…"
              : stats.lockedValue === undefined
                ? "Unavailable"
                : formatUsd(stats.lockedValue)}
          </strong>
          <span>{stats.lockedPartial ? "Partial · available Sets only" : "Estimated USD"}</span>
        </article>
      </div>

      {zeroOwned && (
        <div className="portfolio-zero-state" role="status">
          <p>No attributed Set shares in this wallet yet.</p>
          <Link className="secondary-link" to={setsPath()}>Browse Sets to deposit</Link>
        </div>
      )}
    </section>
  );
}
