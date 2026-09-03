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

const ethereumSourceAssets = [
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
] as const satisfies readonly SourceAssetDeployment[];

const bnbSourceAssets = [
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
] as const satisfies readonly SourceAssetDeployment[];

const baseSourceAssets = [
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

/**
 * Explicit source deployments approved for route discovery. Every routed chain
 * has an entry; an empty entry deliberately means that symbols on that chain are
 * unsupported until a canonical contract is verified and added here.
 */
export const sourceAssetsByChain = {
  1: ethereumSourceAssets,
  56: bnbSourceAssets,
  8453: baseSourceAssets,
  4663: [],
} as const satisfies Record<RoutedSwapChainId, readonly SourceAssetDeployment[]>;

export const canonicalSourceAssets: readonly SourceAssetDeployment[] =
  Object.values(sourceAssetsByChain).flat();

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
  return sourceAssetsByChain[chainId];
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
