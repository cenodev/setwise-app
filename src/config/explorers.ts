import { base, bsc, bscTestnet, mainnet, robinhood } from "@reown/appkit/networks";
import type { Address, Hash } from "viem";

import { runtimeConfig } from "./env";

/**
 * Explorer lookup for any chain that can appear in activity evidence. The BSC
 * Testnet entry follows the deployment configuration so environment overrides
 * keep working for legacy Setwise records.
 */
const explorerUrlByChainId = new Map<number, string>(
  [mainnet, bsc, base, robinhood, bscTestnet].map((network) => [
    network.id,
    network.id === bscTestnet.id ? runtimeConfig.explorerUrl : network.blockExplorers.default.url,
  ]),
);

function explorerUrl(chainId: number): string | undefined {
  return explorerUrlByChainId.get(chainId);
}

export function explorerTxUrl(chainId: number, hash: Hash): string | undefined {
  const base = explorerUrl(chainId);
  return base ? `${base}/tx/${hash}` : undefined;
}

export function explorerAddressUrl(chainId: number, address: Address): string | undefined {
  const base = explorerUrl(chainId);
  return base ? `${base}/address/${address}` : undefined;
}
