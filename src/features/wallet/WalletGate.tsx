import { useAppKit } from "@reown/appkit/react";
import type { PropsWithChildren } from "react";
import { Link } from "react-router-dom";
import { useAccount, useSwitchChain } from "wagmi";

import { requiredChainId } from "../../config/chains";
import { runtimeConfig } from "../../config/env";

function ConnectAction() {
  const { open } = useAppKit();
  return (
    <button className="primary-button" type="button" onClick={() => void open({ view: "Connect" })}>
      Connect wallet
    </button>
  );
}

export function WalletGate({ children }: PropsWithChildren) {
  const { chainId, isConnected } = useAccount();
  const switchChain = useSwitchChain();

  if (!runtimeConfig.walletConfigured) {
    return (
      <section className="gate-card" aria-labelledby="wallet-setup-title">
        <p className="eyebrow">Configuration required</p>
        <h2 id="wallet-setup-title">Add a Reown project ID</h2>
        <p>
          Copy <code>.env.example</code> to <code>.env.local</code>, set
          <code> VITE_REOWN_PROJECT_ID</code>, and restart the development server.
        </p>
        <p className="gate-help">After wallet setup, use the <Link to="/faucet">testnet asset faucet</Link> to fund a new wallet.</p>
      </section>
    );
  }

  if (!isConnected) {
    return (
      <section className="gate-card" aria-labelledby="wallet-connect-title">
        <p className="eyebrow">External wallet</p>
        <h2 id="wallet-connect-title">Connect your wallet to continue</h2>
        <p>Setwise will never ask for your seed phrase or private key.</p>
        <p className="gate-help">You can claim mock portfolio assets from the <Link to="/faucet">Setwise faucet</Link> after connecting.</p>
        <ConnectAction />
      </section>
    );
  }

  if (chainId !== requiredChainId) {
    return (
      <section className="gate-card" aria-labelledby="network-switch-title">
        <p className="eyebrow eyebrow--critical">Wrong network</p>
        <h2 id="network-switch-title">BSC Testnet is required</h2>
        <p>Switch networks before requesting prices or submitting transactions.</p>
        <button
          className="primary-button"
          type="button"
          disabled={switchChain.isPending}
          onClick={() => switchChain.switchChain({ chainId: requiredChainId })}
        >
          {switchChain.isPending ? "Switching network…" : "Switch to BSC Testnet"}
        </button>
      </section>
    );
  }

  return children;
}
