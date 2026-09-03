import type { Address } from "viem";

import {
  createDestinationMarketCatalog,
  destinationMarketId,
  destinationMarketsForUnderlying,
  requireDestinationMarket,
  UnsupportedDestinationMarketError,
  type DestinationStockMarket,
} from "./markets";

const sharedAddress = "0x1000000000000000000000000000000000000000" as Address;
const alternateAddress = "0x2000000000000000000000000000000000000000" as Address;

function market(overrides: Partial<DestinationStockMarket> = {}): DestinationStockMarket {
  return {
    address: sharedAddress,
    assetProvider: { id: "robinhood", name: "Robinhood Assets (Jersey) Limited" },
    chainId: 4663,
    decimals: 18,
    issuerScaling: { kind: "erc-8056", multiplier: "1" },
    symbol: "AAPL",
    underlying: { name: "Apple Inc.", symbol: "AAPL" },
    ...overrides,
  };
}

describe("destination stock-token markets", () => {
  it("keeps multiple issuers for one underlying as distinct selectable outputs", () => {
    const robinhoodMarket = market();
    const ondoMarket = market({
      address: alternateAddress,
      assetProvider: { id: "ondo", name: "Ondo" },
      chainId: 1,
      symbol: "AAPLon",
    });
    const catalog = createDestinationMarketCatalog([robinhoodMarket, ondoMarket]);

    expect(destinationMarketsForUnderlying(catalog, "aapl")).toEqual([robinhoodMarket, ondoMarket]);
    expect(destinationMarketId(robinhoodMarket)).not.toBe(destinationMarketId(ondoMarket));
  });

  it("keys identity by chain and address, never by symbol", () => {
    const robinhoodMarket = market();
    const sameAddressOnEthereum = market({
      assetProvider: { id: "another", name: "Another issuer" },
      chainId: 1,
      symbol: robinhoodMarket.symbol,
    });
    const catalog = createDestinationMarketCatalog([robinhoodMarket, sameAddressOnEthereum]);

    expect(destinationMarketId(robinhoodMarket)).not.toBe(destinationMarketId(sameAddressOnEthereum));
    expect(requireDestinationMarket(catalog, 1, sharedAddress)).toBe(sameAddressOnEthereum);
    expect(requireDestinationMarket(catalog, 4663, sharedAddress)).toBe(robinhoodMarket);
  });

  it("rejects collisions and wrong-chain deployment lookups", () => {
    expect(() => createDestinationMarketCatalog([
      market(),
      market({ assetProvider: { id: "imposter", name: "Imposter" }, symbol: "FAKE" }),
    ])).toThrow(/Duplicate token deployment/);

    const catalog = createDestinationMarketCatalog([market()]);
    expect(() => requireDestinationMarket(catalog, 1, sharedAddress)).toThrow(
      UnsupportedDestinationMarketError,
    );
  });

  it("rejects markets deployed outside the routed network registry", () => {
    expect(() => createDestinationMarketCatalog([
      market({ chainId: 10 as DestinationStockMarket["chainId"] }),
    ])).toThrow(/unsupported chain 10/);
  });
});
