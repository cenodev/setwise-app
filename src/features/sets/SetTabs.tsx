import { Link, useOutletContext } from "react-router-dom";

import { DepositPage } from "../deposit/DepositPage";
import { PoolPage } from "../pool-analytics/PoolPage";
import { WalletGate } from "../wallet/WalletGate";
import { WithdrawPage } from "../withdraw/WithdrawPage";
import { setPath } from "../../app/routes";
import type { SetOutletContext } from "./SetDetailLayout";

function useSetOutlet(): SetOutletContext {
  return useOutletContext<SetOutletContext>();
}

export function SetOverviewTab() {
  const {
    error,
    loading,
    pool,
    poolState,
    refreshing,
    retry,
    unsupported,
  } = useSetOutlet();

  return (
    <div className="set-tab-panel">
      <header className="set-tab-header">
        <p className="eyebrow">Public Set</p>
        <h2>Set overview</h2>
        <p>
          Track this Set’s total value, LP supply, reserve composition, and your connected wallet position.
        </p>
      </header>
      <PoolPage
        error={error}
        loading={loading}
        onRetry={retry}
        pool={pool}
        poolState={poolState}
        refreshing={refreshing}
        showWalletPosition={!unsupported}
      />
      <aside className="disclosure" role="note">
        <strong>Testnet only.</strong> Reserve values are indicative and can change with market prices.
      </aside>
    </div>
  );
}

export function SetDepositTab() {
  const {
    definition,
    operationUnavailable,
    pool,
    poolState,
    setNavigationLocked,
  } = useSetOutlet();

  if (operationUnavailable.deposit) {
    return (
      <section className="prototype-card" role="status">
        <h2>Deposits unavailable</h2>
        <p>{operationUnavailable.deposit}</p>
        <Link className="secondary-link" to={setPath(definition.id, "overview")}>Back to overview</Link>
      </section>
    );
  }

  if (!pool || !poolState) {
    return <section className="prototype-card" aria-live="polite">Loading Set deposit data…</section>;
  }

  return (
    <div className="set-tab-panel">
      <header className="set-tab-header">
        <p className="eyebrow">Liquidity</p>
        <h2>Deposit into this Set</h2>
        <p>Deposit one asset or build the Set’s target portfolio and receive Setwise shares.</p>
      </header>
      <WalletGate>
        <DepositPage
          key={definition.id}
          onNavigationLockChange={setNavigationLocked}
          pool={pool}
          poolState={poolState}
        />
      </WalletGate>
      <aside className="disclosure" role="note">
        <strong>Testnet only.</strong> Contracts are unaudited, tokenized assets carry issuer and market risk, and this is not investment advice.
      </aside>
    </div>
  );
}

export function SetWithdrawTab() {
  const {
    definition,
    operationUnavailable,
    pool,
    poolState,
    refreshPoolState,
    setNavigationLocked,
  } = useSetOutlet();

  if (operationUnavailable.withdraw) {
    return (
      <section className="prototype-card" role="status">
        <h2>Withdrawals unavailable</h2>
        <p>{operationUnavailable.withdraw}</p>
        <Link className="secondary-link" to={setPath(definition.id, "overview")}>Back to overview</Link>
      </section>
    );
  }

  if (!pool || !poolState) return null;

  return (
    <div className="set-tab-panel">
      <header className="set-tab-header">
        <p className="eyebrow">Liquidity</p>
        <h2>Withdraw from this Set</h2>
        <p>Burn unlocked Setwise shares for every Set asset or one selected asset.</p>
      </header>
      <WalletGate>
        <WithdrawPage
          key={definition.id}
          onBusyChange={setNavigationLocked}
          pool={pool}
          poolState={poolState}
          refreshPoolState={refreshPoolState}
        />
      </WalletGate>
      <aside className="disclosure" role="note">
        <strong>Testnet only.</strong> Contracts are unaudited, tokenized assets carry issuer and market risk, and this is not investment advice.
      </aside>
    </div>
  );
}
