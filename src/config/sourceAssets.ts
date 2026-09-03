import type { Address } from "viem";

import type { RoutedSwapChainId } from "./chains";
import {
  createTokenDeploymentIndex,
  findTokenDeployment,
  type TokenDeployment,
} from "../data/tokenDeployments";

export type SourceAssetSymbol = "USDC" | "USDT";

export type SourceAssetDeployment = TokenDeployment & Readonly<{
  assetProvider: "base-bridge" | "binance-peg" | "circle" | "tether";
  chainId: RoutedSwapChainId;
  symbol: SourceAssetSymbol;
}>;

/**
 * Explicit source deployments approved for route discovery. This is an allowlist,
 * not a symbol lookup: a chain with no verified deployment remains unsupported.
 */
export const canonicalSourceAssets = [
  {
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    assetProvider: "circle",
    chainId: 1,
    decimals: 6,
    symbol: "USDC",
  },
  {
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    assetProvider: "tether",
    chainId: 1,
    decimals: 6,
    symbol: "USDT",
  },
  {
    address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    assetProvider: "binance-peg",
    chainId: 56,
    decimals: 18,
    symbol: "USDC",
  },
  {
    address: "0x55d398326f99059fF775485246999027B3197955",
    assetProvider: "binance-peg",
    chainId: 56,
    decimals: 18,
    symbol: "USDT",
  },
  {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    assetProvider: "circle",
    chainId: 8453,
    decimals: 6,
    symbol: "USDC",
  },
  {
    address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    assetProvider: "base-bridge",
    chainId: 8453,
    decimals: 6,
    symbol: "USDT",
  },
] as const satisfies readonly SourceAssetDeployment[];

const sourceAssetsByDeployment = createTokenDeploymentIndex(canonicalSourceAssets);
const sourceAssetsByChainAndSymbol = new Map<string, SourceAssetDeployment>(
  canonicalSourceAssets.map((asset) => [`${asset.chainId}:${asset.symbol}`, asset]),
);

export class UnsupportedSourceAssetDeploymentError extends Error {
  constructor(chainId: number, symbolOrAddress: string) {
    super(`No approved ${symbolOrAddress} source-asset deployment is configured on chain ${chainId}`);
    this.name = "UnsupportedSourceAssetDeploymentError";
  }
}

export function getSourceAssets(chainId: RoutedSwapChainId): readonly SourceAssetDeployment[] {
  return canonicalSourceAssets.filter((asset) => asset.chainId === chainId);
}

export function requireSourceAsset(
  chainId: RoutedSwapChainId,
  symbol: SourceAssetSymbol,
): SourceAssetDeployment {
  const deployment = sourceAssetsByChainAndSymbol.get(`${chainId}:${symbol}`);
  if (!deployment) throw new UnsupportedSourceAssetDeploymentError(chainId, symbol);
  return deployment;
}

export function requireSourceAssetDeployment(
  chainId: RoutedSwapChainId,
  address: Address,
): SourceAssetDeployment {
  const deployment = findTokenDeployment(sourceAssetsByDeployment, { address, chainId });
  if (!deployment) throw new UnsupportedSourceAssetDeploymentError(chainId, address);
  return deployment;
}
