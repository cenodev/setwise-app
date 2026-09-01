import { generatedAssetDescription, groupRwaAssets, groupUnderlyingStocks } from "./assets";
import type { TokenMetadata } from "./tokens";

const base: TokenMetadata = {
  address: "0x1000000000000000000000000000000000000000",
  assetType: "equity",
  chainId: 1,
  chainName: "Ethereum",
  name: "NVIDIA token",
  provider: "example-provider",
  symbol: "NVDAx",
  underlyingSymbol: "NVDA",
};

describe("RWA asset catalog", () => {
  it("groups the same provider and underlying across network deployments", () => {
    const assets = groupRwaAssets([
      base,
      { ...base, address: "0x2000000000000000000000000000000000000000", chainId: 56, chainName: "BNB Smart Chain" },
      { ...base, address: "0x3000000000000000000000000000000000000000", provider: "another-provider" },
    ]);
    expect(assets).toHaveLength(2);
    expect(assets.find((asset) => asset.provider === "Example Provider")?.tokens).toHaveLength(2);
  });

  it("groups every provider under one underlying stock", () => {
    const stocks = groupUnderlyingStocks([
      base,
      { ...base, address: "0x2000000000000000000000000000000000000000", provider: "another-provider", symbol: "aNVDA" },
      { ...base, address: "0x3000000000000000000000000000000000000000", underlyingSymbol: "TSLA", symbol: "TSLAx" },
    ]);

    expect(stocks).toHaveLength(2);
    expect(stocks[0]).toMatchObject({ id: "nvda", providers: ["Another Provider", "Example Provider"], symbol: "NVDA" });
    expect(stocks[0]?.tokens).toHaveLength(2);
    expect(stocks[1]).toMatchObject({ id: "tsla", symbol: "TSLA" });
  });

  it("uses editorial descriptions when present and otherwise generates a qualified fallback", () => {
    expect(groupRwaAssets([{ ...base, description: "Editorial copy" }])[0]?.description).toBe("Editorial copy");
    expect(generatedAssetDescription(base)).toContain("Token-holder rights and availability depend");
  });
});
