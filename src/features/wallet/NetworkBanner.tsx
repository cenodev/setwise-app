import { useAccount, useSwitchChain } from "wagmi";

import { requiredChainId } from "../../config/chains";
import { runtimeConfig } from "../../config/env";

export function NetworkBanner() {
  const { chainId, isConnected } = useAccount();
  const switchChain = useSwitchChain();

  if (!runtimeConfig.walletConfigured || !isConnected || chainId === requiredChainId) {
    return null;
  }

  return (
    <div className="status-banner status-banner--critical" role="alert">
      <span>Wrong network — BSC Testnet required.</span>
      <button
        type="button"
        disabled={switchChain.isPending}
        onClick={() => switchChain.switchChain({ chainId: requiredChainId })}
      >
        {switchChain.isPending ? "Switching…" : "Switch network"}
      </button>
    </div>
  );
}
