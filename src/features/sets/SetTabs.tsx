import { Link, useOutletContext } from "react-router-dom";

import type { SetDefinition } from "../../data/sets";
import { DepositPage } from "../deposit/DepositPage";
import { PoolPage } from "../pool-analytics/PoolPage";
import { WalletGate } from "../wallet/WalletGate";
import { WithdrawPage } from "../withdraw/WithdrawPage";
import { setPath, swapPath } from "../../app/routes";

type SetOutletContext = {
  definition: SetDefinition;
  unsupported: boolean;
};

function useSetOutlet(): SetOutletContext {
  return useOutletContext<SetOutletContext>();
}

export function SetOverviewTab() {
  const { definition, unsupported } = useSetOutlet();

  return (
    <div className="set-tab-panel">
      <header className="set-tab-header">
        <p className="eyebrow">Public Set</p>
        <h2>Set overview</h2>
        <p>
          Track this Set’s total value, LP supply, and usable reserve liquidity
          {unsupported ? "." : " without connecting a wallet."}
        </p>
      </header>
      {!unsupported && <PoolPage />}
      {unsupported && (
        <section className="prototype-card">
          <p>
            Live overview for <code>{definition.id}</code> will render here once this chain is supported.
            The Set’s underlying liquidity pool remains on chain {definition.chainId}.
          </p>
          <Link className="secondary-link" to={swapPath()}>Open Swap</Link>
        </section>
      )}
      <aside className="disclosure" role="note">
        <strong>Testnet only.</strong> Reserve values are indicative and can change with market prices.
      </aside>
    </div>
  );
}

export function SetDepositTab() {
  const { definition, unsupported } = useSetOutlet();

  if (unsupported) {
    return (
      <section className="prototype-card" role="status">
        <h2>Deposits unavailable</h2>
        <p>
          <code>{definition.id}</code> is on an unsupported chain. Choose another Set to deposit.
        </p>
        <Link className="secondary-link" to={setPath(definition.id, "overview")}>Back to overview</Link>
      </section>
    );
  }

  return (
    <div className="set-tab-panel">
      <header className="set-tab-header">
        <p className="eyebrow">Liquidity</p>
        <h2>Deposit into this Set</h2>
        <p>Deposit one asset or build the Set’s target portfolio and receive Setwise shares.</p>
      </header>
      <WalletGate><DepositPage /></WalletGate>
      <aside className="disclosure" role="note">
        <strong>Testnet only.</strong> Contracts are unaudited, tokenized assets carry issuer and market risk, and this is not investment advice.
      </aside>
    </div>
  );
}

export function SetWithdrawTab() {
  const { definition, unsupported } = useSetOutlet();

  if (unsupported) {
    return (
      <section className="prototype-card" role="status">
        <h2>Withdrawals unavailable</h2>
        <p>
          <code>{definition.id}</code> is on an unsupported chain. Choose another Set to withdraw.
        </p>
        <Link className="secondary-link" to={setPath(definition.id, "overview")}>Back to overview</Link>
      </section>
    );
  }

  return (
    <div className="set-tab-panel">
      <header className="set-tab-header">
        <p className="eyebrow">Liquidity</p>
        <h2>Withdraw from this Set</h2>
        <p>Burn unlocked Setwise shares for every Set asset or one selected asset.</p>
      </header>
      <WalletGate><WithdrawPage /></WalletGate>
      <aside className="disclosure" role="note">
        <strong>Testnet only.</strong> Contracts are unaudited, tokenized assets carry issuer and market risk, and this is not investment advice.
      </aside>
    </div>
  );
}
