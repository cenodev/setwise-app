import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";

import { NetworkBanner } from "../features/wallet/NetworkBanner";
import { WalletButton } from "../features/wallet/WalletButton";
import { PwaStatus } from "../features/pwa/PwaStatus";

const navigation = [
  { label: "Pool", to: "/pool" },
  { label: "Swap", to: "/swap" },
  { label: "Deposit", to: "/deposit" },
  { label: "Withdraw", to: "/withdraw" },
  { label: "Activity", to: "/activity" },
];

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink className="brand" to="/swap" aria-label="Setwise home">
          <img src="/setwise-mark.svg" alt="" width="32" height="32" />
          <span>Setwise</span>
        </NavLink>
        <span className="testnet-badge">BSC Testnet</span>
        <WalletButton />
      </header>

      <div className="banner-stack">
        <NetworkBanner />
        <PwaStatus />
        <div className="risk-line" role="note">
          Unaudited testnet prototype. Do not move mainnet funds.
        </div>
      </div>

      <nav className="desktop-nav" aria-label="Primary navigation">
        {navigation.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? "nav-link is-active" : "nav-link"}>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main className="app-main">{children}</main>

      <nav className="mobile-nav" aria-label="Primary navigation">
        {navigation.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? "nav-link is-active" : "nav-link"}>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
