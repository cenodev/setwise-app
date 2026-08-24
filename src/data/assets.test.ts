import { generatedAssetDescription, groupRwaAssets } from "./assets";
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

  it("uses editorial descriptions when present and otherwise generates a qualified fallback", () => {
    expect(groupRwaAssets([{ ...base, description: "Editorial copy" }])[0]?.description).toBe("Editorial copy");
    expect(generatedAssetDescription(base)).toContain("Token-holder rights and availability depend");
  });
});
