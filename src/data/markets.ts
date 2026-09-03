import type { Address } from "viem";

import { isRoutedSwapChainId, type RoutedSwapChainId } from "../config/chains";
import {
  createTokenDeploymentIndex,
  findTokenDeployment,
  tokenDeploymentKey,
  TokenDeploymentError,
  type TokenDeployment,
} from "./tokenDeployments";

export type AssetProvider = Readonly<{
  id: string;
  name: string;
}>;

export type IssuerScaling = Readonly<
  | { kind: "erc-8056"; multiplier?: string }
  | { kind: "fixed"; multiplier: string }
>;

export type DestinationStockMarket = TokenDeployment & Readonly<{
  assetProvider: AssetProvider;
  chainId: RoutedSwapChainId;
  issuerScaling?: IssuerScaling;
  underlying: Readonly<{
    name?: string;
    symbol: string;
  }>;
}>;

export type DestinationMarketCatalog = Readonly<{
  byDeployment: ReadonlyMap<string, DestinationStockMarket>;
  byUnderlying: ReadonlyMap<string, readonly DestinationStockMarket[]>;
  markets: readonly DestinationStockMarket[];
}>;

export class UnsupportedDestinationMarketError extends Error {
  constructor(chainId: number, address: Address) {
    super(`No destination stock-token market is configured for ${chainId}:${address.toLowerCase()}`);
    this.name = "UnsupportedDestinationMarketError";
  }
}

function normalizedUnderlying(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function createDestinationMarketCatalog(
  markets: readonly DestinationStockMarket[],
): DestinationMarketCatalog {
  for (const market of markets) {
    const chainId: number = market.chainId;
    if (!isRoutedSwapChainId(chainId)) {
      throw new TokenDeploymentError(`Destination market uses unsupported chain ${chainId}`);
    }
    if (!market.assetProvider.id.trim() || !market.underlying.symbol.trim()) {
      throw new TokenDeploymentError("Destination market requires an asset provider and underlying");
    }
  }

  const byDeployment = createTokenDeploymentIndex(markets);
  const byUnderlying = new Map<string, DestinationStockMarket[]>();
  for (const market of markets) {
    const key = normalizedUnderlying(market.underlying.symbol);
    byUnderlying.set(key, [...(byUnderlying.get(key) ?? []), market]);
  }
  return { byDeployment, byUnderlying, markets: [...markets] };
}

export function destinationMarketsForUnderlying(
  catalog: DestinationMarketCatalog,
  underlyingSymbol: string,
): readonly DestinationStockMarket[] {
  return catalog.byUnderlying.get(normalizedUnderlying(underlyingSymbol)) ?? [];
}

export function requireDestinationMarket(
  catalog: DestinationMarketCatalog,
  chainId: RoutedSwapChainId,
  address: Address,
): DestinationStockMarket {
  const market = findTokenDeployment(catalog.byDeployment, { address, chainId });
  if (!market) throw new UnsupportedDestinationMarketError(chainId, address);
  return market;
}

export function destinationMarketId(market: DestinationStockMarket): string {
  return tokenDeploymentKey(market);
}
