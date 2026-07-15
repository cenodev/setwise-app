import { WalletGate } from "../features/wallet/WalletGate";

type Operation = "swap" | "deposit" | "withdraw";

const pageCopy: Record<Operation, { eyebrow: string; title: string; description: string }> = {
  swap: {
    eyebrow: "Trade",
    title: "Swap assets",
    description: "Exchange BNB, stablecoins, and supported tokenized assets through the Setwise pool.",
  },
  deposit: {
    eyebrow: "Portfolio",
    title: "Deposit assets",
    description: "Deposit a single asset or a target-weight portfolio and receive Setwise shares.",
  },
  withdraw: {
    eyebrow: "Portfolio",
    title: "Withdraw assets",
    description: "Burn Setwise shares for proportional pool assets or one selected asset.",
  },
};

export function OperationPage({ operation }: { operation: Operation }) {
  const copy = pageCopy[operation];

  return (
    <div className="screen">
      <header className="screen-header">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
      </header>

      <WalletGate>
        <section className="prototype-card">
          <p className="eyebrow">Scaffold ready</p>
          <h2>{copy.title} comes next</h2>
          <p>
            Wallet and network prerequisites are satisfied. The RFQ form and transaction state machine
            will be added in the operation task.
          </p>
        </section>
      </WalletGate>

      <aside className="disclosure" role="note">
        <strong>Testnet only.</strong> Contracts are unaudited and this interface is not investment advice.
      </aside>
    </div>
  );
}
