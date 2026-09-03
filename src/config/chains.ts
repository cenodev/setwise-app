import { base, bsc, bscTestnet, mainnet, robinhood } from "@reown/appkit/networks";

/** Mainnet networks that can participate on either side of a future routed swap. */
export const routedSwapNetworks = [mainnet, bsc, base, robinhood] as const;

export type RoutedSwapChainId = (typeof routedSwapNetworks)[number]["id"];

/**
 * The existing Setwise contracts remain isolated on BSC Testnet. Keeping this
 * deployment outside the routed-mainnet registry prevents catalog support from
 * accidentally authorizing mainnet Setwise operations.
 */
export const setwiseTestnetNetwork = bscTestnet;
export const setwiseTestnetChainId = setwiseTestnetNetwork.id;

export const walletNetworks = [setwiseTestnetNetwork, ...routedSwapNetworks] as const;
export type WalletChainId = (typeof walletNetworks)[number]["id"];

/** @deprecated Use an operation's explicit source chain. */
export const requiredChain = setwiseTestnetNetwork;
/** @deprecated Use an operation's explicit source chain ID. */
export const requiredChainId = setwiseTestnetChainId;
/** @deprecated Use walletNetworks when configuring wallet connectivity. */
export const supportedNetworks = [setwiseTestnetNetwork] as const;

const routedSwapNetworkByChainId = new Map<RoutedSwapChainId, (typeof routedSwapNetworks)[number]>(
  routedSwapNetworks.map((network) => [network.id, network]),
);

const walletNetworkByChainId = new Map<WalletChainId, (typeof walletNetworks)[number]>(
  walletNetworks.map((network) => [network.id, network]),
);

export function isRoutedSwapChainId(chainId: number): chainId is RoutedSwapChainId {
  return routedSwapNetworkByChainId.has(chainId as RoutedSwapChainId);
}

export function getRoutedSwapNetwork(chainId: number) {
  return routedSwapNetworkByChainId.get(chainId as RoutedSwapChainId);
}

export function getWalletNetwork(chainId: number) {
  return walletNetworkByChainId.get(chainId as WalletChainId);
}
