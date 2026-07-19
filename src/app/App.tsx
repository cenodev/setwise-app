import { Navigate, Route, Routes } from "react-router-dom";

import { ActivityPage } from "../pages/ActivityPage";
import { DepositPage } from "../features/deposit/DepositPage";
import { FaucetPage } from "../features/faucet/FaucetPage";
import { WithdrawPage } from "../features/withdraw/WithdrawPage";
import { WalletGate } from "../features/wallet/WalletGate";
import { OperationPage } from "../pages/OperationPage";
import { AppShell } from "./AppShell";

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/swap" replace />} />
        <Route path="/swap" element={<OperationPage operation="swap" />} />
        <Route path="/deposit" element={
          <div className="screen deposit-screen">
            <header className="screen-header">
              <p className="eyebrow">Portfolio</p>
              <h1>Deposit assets</h1>
              <p>Deposit one asset or build the pool’s target portfolio and receive Setwise shares.</p>
            </header>
            <WalletGate><DepositPage /></WalletGate>
            <aside className="disclosure" role="note">
              <strong>Testnet only.</strong> Contracts are unaudited, tokenized assets carry issuer and market risk, and this is not investment advice.
            </aside>
          </div>
        } />
        <Route path="/withdraw" element={
          <div className="screen withdraw-screen">
            <header className="screen-header">
              <p className="eyebrow">Portfolio</p>
              <h1>Withdraw assets</h1>
              <p>Burn unlocked Setwise shares for every pool asset or one selected asset.</p>
            </header>
            <WalletGate><WithdrawPage /></WalletGate>
            <aside className="disclosure" role="note">
              <strong>Testnet only.</strong> Contracts are unaudited, tokenized assets carry issuer and market risk, and this is not investment advice.
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
            <WalletGate><FaucetPage /></WalletGate>
          </div>
        } />
        <Route path="*" element={<Navigate to="/swap" replace />} />
      </Routes>
    </AppShell>
  );
}
