import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";

import { WalletButton } from "../features/wallet/WalletButton";
import { PwaStatus } from "../features/pwa/PwaStatus";
import { activityPath, assetsPath, portfolioPath, setsPath, swapPath } from "./routes";

const navigation = [
  { label: "Explore", to: assetsPath() },
  { label: "Trade", to: swapPath() },
  { label: "Portfolio", to: portfolioPath() },
  { label: "Sets", to: setsPath() },
  { label: "History", to: activityPath() },
];

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink className="brand" to={assetsPath()} aria-label="Setwise home">
          <img src="/setwise-mark.svg" alt="" width="32" height="32" />
          <span>Setwise</span>
        </NavLink>
        <nav className="desktop-nav" aria-label="Primary navigation">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => (isActive ? "nav-link is-active" : "nav-link")}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <span className="testnet-badge">BSC Testnet</span>
        <WalletButton />
      </header>

      <div className="banner-stack">
        <PwaStatus />
        <div className="risk-line" role="note">
          Unaudited testnet prototype. Do not move mainnet funds.
        </div>
      </div>

      <main className="app-main">{children}</main>

      <nav className="mobile-nav" aria-label="Primary navigation">
        {navigation.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) => (isActive ? "nav-link is-active" : "nav-link")}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
