import { useAppKit } from "@reown/appkit/react";
import { formatUnits } from "viem";
import { useAccount, useBalance } from "wagmi";

import { runtimeConfig } from "../../config/env";
import { truncateAddress, truncateDecimal } from "../../lib/format";

function ConfiguredWalletButton() {
  const { open } = useAppKit();
  const { address, chainId, isConnected } = useAccount();
  const balance = useBalance({
    address,
    chainId,
    query: {
      enabled: Boolean(address && chainId),
    },
  });

  const formattedBalance = balance.data
    ? truncateDecimal(formatUnits(balance.data.value, balance.data.decimals), 4)
    : null;

  const label = isConnected && address
    ? `${truncateAddress(address)}${formattedBalance ? ` · ${formattedBalance} ${balance.data?.symbol ?? ""}` : ""}`
    : "Connect wallet";

  return (
    <button
      className="wallet-button"
      type="button"
      onClick={() => void open({ view: isConnected ? "Account" : "Connect" })}
      aria-label={isConnected ? `Wallet ${address ?? "connected"}` : "Connect wallet"}
    >
      <span className={isConnected ? "wallet-dot wallet-dot--connected" : "wallet-dot"} />
      <span>{label}</span>
    </button>
  );
}

export function WalletButton() {
  if (!runtimeConfig.walletConfigured) {
    return (
      <span className="wallet-button wallet-button--disabled" title="Set VITE_REOWN_PROJECT_ID">
        Wallet setup required
      </span>
    );
  }

  return <ConfiguredWalletButton />;
}
