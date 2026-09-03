import { useAppKit } from "@reown/appkit/react";
import type { PropsWithChildren } from "react";
import { Link } from "react-router-dom";
import { useAccount, useSwitchChain } from "wagmi";

import { runtimeConfig } from "../../config/env";
import { getWalletNetworkRequirement } from "./network";

function ConnectAction() {
  const { open } = useAppKit();
  return (
    <button className="primary-button" type="button" onClick={() => void open({ view: "Connect" })}>
      Connect wallet
    </button>
  );
}

type WalletGateProps = PropsWithChildren<{
  destinationChainId?: number;
  sourceChainId: number;
}>;

export function WalletGate({ children, destinationChainId, sourceChainId }: WalletGateProps) {
  const { chainId, isConnected } = useAccount();
  const switchChain = useSwitchChain();
  const networkRequirement = getWalletNetworkRequirement({
    connectedChainId: isConnected ? chainId : undefined,
    destinationChainId: destinationChainId ?? sourceChainId,
    sourceChainId,
  });

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

  if (!isConnected || networkRequirement.kind === "disconnected") {
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

  if (networkRequirement.kind === "unsupported-source") {
    return (
      <section className="gate-card" aria-labelledby="network-unsupported-title">
        <p className="eyebrow eyebrow--critical">Unsupported network</p>
        <h2 id="network-unsupported-title">This source network is not configured</h2>
        <p>Wallet execution is unavailable for source chain {networkRequirement.sourceChainId}.</p>
      </section>
    );
  }

  if (networkRequirement.kind === "switch") {
    const { sourceNetwork } = networkRequirement;
    return (
      <section className="gate-card" aria-labelledby="network-switch-title">
        <p className="eyebrow eyebrow--critical">Wrong network</p>
        <h2 id="network-switch-title">{sourceNetwork.name} is required</h2>
        <p>Switch networks before requesting prices or submitting transactions.</p>
        <button
          className="primary-button"
          type="button"
          disabled={switchChain.isPending}
          onClick={() => switchChain.switchChain({ chainId: sourceNetwork.id })}
        >
          {switchChain.isPending ? "Switching network…" : `Switch to ${sourceNetwork.name}`}
        </button>
      </section>
    );
  }

  return children;
}
