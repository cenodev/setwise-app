import type { Address } from "viem";

import { isRoutedSwapChainId, routedSwapNetworks, type RoutedSwapChainId } from "../config/chains";
import { tokenDeploymentKey } from "./tokenDeployments";
import { providerLabel, type TokenMetadata } from "./assets";

/**
 * UI-facing destination market option. Money is identified only by
 * `(chainId, contractAddress)`; issuer and underlying metadata are display and
 * discovery data and never authorize a quote. Decimals are deliberately absent:
 * they are read onchain for the selected deployment before outputs are shown.
 */
export type RoutedMarketOption = Readonly<{
  address: Address;
  assetProvider: Readonly<{ id: string; name: string }>;
  chainId: RoutedSwapChainId;
  name: string;
  symbol: string;
  underlying: Readonly<{ name?: string; symbol: string }>;
}>;

export type RoutedMarketCatalog = Readonly<{
  byDeployment: ReadonlyMap<string, RoutedMarketOption>;
  markets: readonly RoutedMarketOption[];
  underlyings: readonly string[];
  marketsForUnderlying: (underlyingSymbol: string) => readonly RoutedMarketOption[];
}>;

const evmAddressPattern = /^0x[0-9a-fA-F]{40}$/;

function routedMarketFromToken(token: TokenMetadata): RoutedMarketOption | null {
  if (!isRoutedSwapChainId(token.chainId)) return null;
  if (!evmAddressPattern.test(token.address)) return null;
  const providerId = (token.provider ?? "unknown").trim().toLowerCase();
  return {
    address: token.address as Address,
    assetProvider: { id: providerId, name: providerLabel(providerId) },
    chainId: token.chainId,
    name: token.name,
    symbol: token.symbol,
    underlying: {
      name: token.underlyingSymbol && token.underlyingSymbol !== token.symbol ? token.name : undefined,
      symbol: (token.underlyingSymbol ?? token.symbol).trim().toUpperCase(),
    },
  };
}

const chainOrder = new Map<number, number>(
  routedSwapNetworks.map((network, index) => [network.id, index]),
);

function marketSortKey(market: RoutedMarketOption): string {
  const providerName = market.assetProvider.name.toLowerCase();
  return `${market.chainId}:${providerName}:${market.address.toLowerCase()}`;
}

/**
 * Builds the routed destination-market catalog from the token catalog.
 * Deployments on chains outside the routed registry, non-EVM entries, and
 * duplicates are dropped; grouping by underlying never collapses distinct
 * issuer deployments.
 */
export function createRoutedMarketCatalog(tokens: readonly TokenMetadata[]): RoutedMarketCatalog {
  const markets = new Map<string, RoutedMarketOption>();
  for (const token of tokens) {
    const market = routedMarketFromToken(token);
    if (!market) continue;
    const key = tokenDeploymentKey(market);
    if (markets.has(key)) continue;
    markets.set(key, market);
  }
  const ordered = [...markets.values()].sort((left, right) => {
    const leftChain = chainOrder.get(left.chainId) ?? left.chainId;
    const rightChain = chainOrder.get(right.chainId) ?? right.chainId;
    return leftChain - rightChain || marketSortKey(left).localeCompare(marketSortKey(right));
  });

  const byUnderlying = new Map<string, RoutedMarketOption[]>();
  for (const market of ordered) {
    byUnderlying.set(market.underlying.symbol, [...(byUnderlying.get(market.underlying.symbol) ?? []), market]);
  }
  return {
    byDeployment: markets,
    markets: ordered,
    underlyings: [...byUnderlying.keys()].sort((left, right) => left.localeCompare(right)),
    marketsForUnderlying: (underlyingSymbol: string) =>
      byUnderlying.get(underlyingSymbol.trim().toUpperCase()) ?? [],
  };
}

export class UnavailableRoutedMarketError extends Error {
  constructor(chainId: number, address: string) {
    super(`No routed destination market is available for ${chainId}:${address.toLowerCase()}`);
    this.name = "UnavailableRoutedMarketError";
  }
}

/**
 * Resolves a chain-qualified preselection (for example from a deep link) to the
 * exact market option. A miss is an explicit error: callers must never
 * substitute another issuer's deployment for the same underlying.
 */
export function resolveRoutedMarket(
  catalog: RoutedMarketCatalog,
  chainId: number,
  address: string,
): RoutedMarketOption {
  const market = catalog.byDeployment.get(tokenDeploymentKey({ address: address as Address, chainId }));
  if (!market) throw new UnavailableRoutedMarketError(chainId, address);
  return market;
}
