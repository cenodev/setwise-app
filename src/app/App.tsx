import { Navigate, Route, Routes } from "react-router-dom";

import { setwiseTestnetChainId } from "../config/chains";
import { LegacyRedirect } from "./LegacyRedirect";
import { AppShell } from "./AppShell";
import { assetsPath } from "./routes";
import { SetDetailLayout } from "../features/sets/SetDetailLayout";
import { SetDepositTab, SetOverviewTab, SetWithdrawTab } from "../features/sets/SetTabs";
import { FaucetPage } from "../features/faucet/FaucetPage";
import { RoutedSwapPage } from "../features/swap/RoutedSwapPage";
import { SwapPage } from "../features/swap/SwapPage";
import { WalletGate } from "../features/wallet/WalletGate";
import { ActivityPage } from "../pages/ActivityPage";
import { AssetDetailPage } from "../pages/AssetDetailPage";
import { AssetsPage } from "../pages/AssetsPage";
import { PortfolioPage } from "../pages/PortfolioPage";
import { SetsPage } from "../pages/SetsPage";

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<AssetsPage />} />
        <Route path="/sets" element={<SetsPage />} />
        <Route path="/assets" element={<Navigate to={assetsPath()} replace />} />
        <Route path="/assets/:assetId" element={<AssetDetailPage />} />
        <Route path="/sets/:setId" element={<SetDetailLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<SetOverviewTab />} />
          <Route path="deposit" element={<SetDepositTab />} />
          <Route path="withdraw" element={<SetWithdrawTab />} />
        </Route>
        <Route path="/portfolio" element={<PortfolioPage />} />
        <Route path="/swap" element={
          <div className="screen swap-screen">
            <header className="screen-header">
              <p className="eyebrow">Trade</p>
              <h1>Swap assets</h1>
              <p>Exchange supported Set assets using exact-input or exact-output quotes on BSC Testnet.</p>
            </header>
            <WalletGate sourceChainId={setwiseTestnetChainId}><SwapPage /></WalletGate>
            <aside className="disclosure" role="note">
              <strong>Testnet only.</strong> Contracts are unaudited, tokenized assets carry issuer and market risk, and this is not investment advice.
            </aside>
          </div>
        } />
        <Route path="/swap/routed" element={
          <div className="screen swap-screen">
            <header className="screen-header">
              <p className="eyebrow">Trade</p>
              <h1>Swap into a market</h1>
              <p>Spend a canonical stablecoin on a supported network and acquire one explicitly selected issuer market. Routes are revalidated immediately before your wallet opens.</p>
            </header>
            <RoutedSwapPage />
            <aside className="disclosure" role="note">
              <strong>Non-custodial execution.</strong> Your wallet signs the approval and source transaction; Setwise never custodies keys or broadcasts for you. Tokenized assets carry issuer and market risk, and this is not investment advice.
            </aside>
          </div>
        } />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/faucet" element={
          <div className="screen faucet-screen">
            <header className="screen-header">
              <p className="eyebrow">BSC Testnet</p>
              <h1>Get mock assets</h1>
              <p>Claim mUSDT and every configured mock bStock in one rate-limited transaction.</p>
            </header>
            <WalletGate sourceChainId={setwiseTestnetChainId}><FaucetPage /></WalletGate>
          </div>
        } />

        {/* Compatibility redirects for the retired single-pool URLs. */}
        <Route path="/pool" element={<LegacyRedirect tab="overview" />} />
        <Route path="/deposit" element={<LegacyRedirect tab="deposit" />} />
        <Route path="/withdraw" element={<LegacyRedirect tab="withdraw" />} />

        <Route path="*" element={<Navigate to={assetsPath()} replace />} />
      </Routes>
    </AppShell>
  );
}
