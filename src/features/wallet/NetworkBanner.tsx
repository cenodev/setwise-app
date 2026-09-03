import { useAccount, useSwitchChain } from "wagmi";

import { runtimeConfig } from "../../config/env";
import { getWalletNetworkRequirement } from "./network";

export function NetworkBanner({
  destinationChainId,
  sourceChainId,
}: {
  destinationChainId?: number;
  sourceChainId: number;
}) {
  const { chainId, isConnected } = useAccount();
  const switchChain = useSwitchChain();
  const requirement = getWalletNetworkRequirement({
    connectedChainId: isConnected ? chainId : undefined,
    destinationChainId: destinationChainId ?? sourceChainId,
    sourceChainId,
  });

  if (!runtimeConfig.walletConfigured || !isConnected
    || requirement.kind === "ready" || requirement.kind === "disconnected") {
    return null;
  }

  if (requirement.kind === "unsupported-source") {
    return (
      <div className="status-banner status-banner--critical" role="alert">
        <span>Source chain {requirement.sourceChainId} is not configured for wallet execution.</span>
      </div>
    );
  }

  const { sourceNetwork } = requirement;

  return (
    <div className="status-banner status-banner--critical" role="alert">
      <span>Wrong network — {sourceNetwork.name} required.</span>
      <button
        type="button"
        disabled={switchChain.isPending}
        onClick={() => switchChain.switchChain({ chainId: sourceNetwork.id })}
      >
        {switchChain.isPending ? "Switching…" : "Switch network"}
      </button>
    </div>
  );
}
