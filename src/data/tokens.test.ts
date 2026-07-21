import {
  TokenListError,
  createTokenMetadataIndex,
  enrichTokenDisplay,
  parseTokenList,
  tokenMetadataKey,
} from "./tokens";

const address = "0x1000000000000000000000000000000000000000";

const token = {
  address,
  assetType: "equity",
  chainId: 97,
  logoURI: "https://assets.example/token.png",
  name: "Canonical Token",
  symbol: "CAN",
  underlyingSymbol: "CANO",
};

describe("token metadata", () => {
  it("validates multi-chain metadata and indexes by chain and normalized address", () => {
    const index = createTokenMetadataIndex(parseTokenList({ tokens: [token, {
      ...token,
      address: "123mYEnRLM2LLYsJW3K6oyYh8uP1fngj732iG638ondo",
      chainId: 101,
    }, {
      ...token,
      address: "ton-token-address",
      chainId: -239,
    }] }));
    expect(index.get(tokenMetadataKey(97, address.toUpperCase()))).toEqual(token);
    expect(index.get(tokenMetadataKey(56, address))).toBeUndefined();
  });

  it("does not match a token by symbol or an address on the wrong chain", () => {
    const index = createTokenMetadataIndex([token]);
    expect(enrichTokenDisplay({ address, symbol: "CAN", name: "RFQ token" }, 56, index)).toEqual({
      name: "RFQ token", symbol: "CAN", underlyingSymbol: undefined, assetType: undefined, logoURI: undefined,
    });
  });

  it("prefers matched metadata and retains RFQ fields as a stable fallback", () => {
    const index = createTokenMetadataIndex([token]);
    expect(enrichTokenDisplay({ address, symbol: "OLD", name: "Old token", underlying: { symbol: "OLDCO" } }, 97, index)).toEqual({
      assetType: "equity", logoURI: "https://assets.example/token.png", name: "Canonical Token", symbol: "CAN", underlyingSymbol: "CANO",
    });
    expect(enrichTokenDisplay({ address, symbol: "OLD", underlying: { symbol: "OLDCO" } }, 97)).toEqual({
      assetType: undefined, logoURI: undefined, name: "OLD", symbol: "OLD", underlyingSymbol: "OLDCO",
    });
  });

  it("rejects malformed, partial, and duplicate data", () => {
    expect(() => parseTokenList({ tokens: [{ chainId: 97, symbol: "MISSING" }] })).toThrow(TokenListError);
    expect(() => parseTokenList({ tokens: [] })).not.toThrow();
    expect(() => createTokenMetadataIndex([token, { ...token, address: address.toUpperCase() }])).toThrow(/duplicate/);
  });
});
