import { describe, expect, it } from "vitest";

import { createRoutedMarketCatalog, resolveRoutedMarket, UnavailableRoutedMarketError } from "./marketCatalog";
import type { TokenMetadata } from "./tokens";

const token = (overrides: Partial<TokenMetadata>): TokenMetadata => ({
  address: "0x0000000000000000000000000000000000000001",
  chainId: 8453,
  name: "Test Token",
  symbol: "TEST",
  ...overrides,
});

const baseToken = token({
  address: "0xAbC0000000000000000000000000000000000001",
  chainId: 8453,
  name: "NVIDIA xStock",
  provider: "backed",
  symbol: "NVDAx",
  underlyingSymbol: "NVDA",
});

describe("createRoutedMarketCatalog", () => {
  it("keeps routed-chain EVM deployments with issuer and underlying metadata", () => {
    const catalog = createRoutedMarketCatalog([baseToken]);
    expect(catalog.markets).toHaveLength(1);
    const market = catalog.markets[0];
    expect(market.address).toBe("0xAbC0000000000000000000000000000000000001");
    expect(market.chainId).toBe(8453);
    expect(market.assetProvider).toEqual({ id: "backed", name: "Backed" });
    expect(market.underlying).toEqual({ name: "NVIDIA xStock", symbol: "NVDA" });
  });

  it("drops non-routed chains and non-EVM addresses instead of failing the catalog", () => {
    const catalog = createRoutedMarketCatalog([
      token({ address: "0xabc", chainId: 97, symbol: "MOCK", underlyingSymbol: "NVDA" }),
      token({ address: "EQDefg", chainId: 1, symbol: "TON", underlyingSymbol: "NVDA" }),
      baseToken,
    ]);
    expect(catalog.markets).toHaveLength(1);
  });

  it("groups by underlying without collapsing distinct issuer deployments", () => {
    const catalog = createRoutedMarketCatalog([
      baseToken,
      token({
        address: "0xAbC0000000000000000000000000000000000002",
        chainId: 1,
        name: "NVIDIA Tokenized",
        provider: "omega",
        symbol: "nNVDA",
        underlyingSymbol: "NVDA",
      }),
      token({ address: "0xAbC0000000000000000000000000000000000003", chainId: 1, provider: "backed", symbol: "TSLAx", underlyingSymbol: "TSLA" }),
    ]);
    expect(catalog.underlyings).toEqual(["NVDA", "TSLA"]);
    const nvdaMarkets = catalog.marketsForUnderlying("nvda");
    expect(nvdaMarkets).toHaveLength(2);
    expect(new Set(nvdaMarkets.map((market) => market.address))).toHaveProperty("size", 2);
    expect(new Set(nvdaMarkets.map((market) => market.assetProvider.id))).toHaveProperty("size", 2);
    // Order is deterministic: registry chain order, then provider name, then address.
    expect(nvdaMarkets[0].chainId).toBe(1);
    expect(nvdaMarkets[1].chainId).toBe(8453);
    expect(catalog.marketsForUnderlying("missing")).toEqual([]);
  });

  it("treats a token without an underlying as its own underlying", () => {
    const catalog = createRoutedMarketCatalog([
      token({ address: "0xAbC0000000000000000000000000000000000009", provider: "backed", symbol: "SPYX" }),
    ]);
    expect(catalog.underlyings).toEqual(["SPYX"]);
    expect(catalog.marketsForUnderlying("SPYX")[0].underlying.symbol).toBe("SPYX");
  });

  it("deduplicates repeated chain-qualified deployments", () => {
    const catalog = createRoutedMarketCatalog([baseToken, { ...baseToken, name: "Duplicate" }]);
    expect(catalog.markets).toHaveLength(1);
  });

  it("resolves an exact chain-qualified preselection", () => {
    const catalog = createRoutedMarketCatalog([baseToken]);
    const market = resolveRoutedMarket(catalog, 8453, "0xABC0000000000000000000000000000000000001");
    expect(market.assetProvider.id).toBe("backed");
  });

  it("fails explicitly when a preselected market is unavailable instead of substituting one", () => {
    const catalog = createRoutedMarketCatalog([baseToken]);
    expect(() => resolveRoutedMarket(catalog, 1, baseToken.address)).toThrow(UnavailableRoutedMarketError);
    expect(() => resolveRoutedMarket(catalog, 8453, "0x0000000000000000000000000000000000000002"))
      .toThrow(UnavailableRoutedMarketError);
  });
});
