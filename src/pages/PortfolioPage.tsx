import { Link } from "react-router-dom";

import { setsPath, swapPath } from "../app/routes";

export function PortfolioPage() {
  return (
    <div className="screen portfolio-screen">
      <header className="screen-header">
        <p className="eyebrow">Balances</p>
        <h1>Portfolio</h1>
        <p>Aggregate Setwise liquidity and your per-Set positions will appear here.</p>
      </header>

      <section className="prototype-card">
        <p className="eyebrow">Coming next</p>
        <h2>Multi-Set portfolio aggregation</h2>
        <p>
          Connect a wallet and open a Set to deposit, withdraw, or review a single position today.
          Aggregate totals across Sets ship in a follow-up.
        </p>
        <div className="banner-actions">
          <Link className="secondary-link" to={setsPath()}>Browse Sets</Link>
          <Link className="secondary-link" to={swapPath()}>Open Swap</Link>
        </div>
      </section>
    </div>
  );
}
