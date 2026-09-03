import { getWalletNetwork, type WalletNetwork } from "../../config/chains";

export type RoutedWalletContext = Readonly<{
  connectedChainId: number | undefined;
  destinationChainId: number;
  sourceChainId: number;
}>;

export type WalletNetworkRequirement =
  | Readonly<{ kind: "disconnected"; sourceNetwork: WalletNetwork }>
  | Readonly<{ kind: "ready"; sourceNetwork: WalletNetwork }>
  | Readonly<{ kind: "switch"; sourceNetwork: WalletNetwork }>
  | Readonly<{ kind: "unsupported-source"; sourceChainId: number }>;

/**
 * Wallet execution belongs to the route's source chain. The destination chain
 * remains explicit in the context so callers cannot substitute it accidentally.
 */
export function getWalletNetworkRequirement(
  context: RoutedWalletContext,
): WalletNetworkRequirement {
  const sourceNetwork = getWalletNetwork(context.sourceChainId);
  if (!sourceNetwork) return { kind: "unsupported-source", sourceChainId: context.sourceChainId };
  if (context.connectedChainId === undefined) return { kind: "disconnected", sourceNetwork };
  if (context.connectedChainId === context.sourceChainId) return { kind: "ready", sourceNetwork };
  return { kind: "switch", sourceNetwork };
}
