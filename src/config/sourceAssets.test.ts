import {
  getSourceAssets,
  requireSourceAsset,
  requireSourceAssetDeployment,
  sourceAssetsByChain,
  UnsupportedSourceAssetDeploymentError,
} from "./sourceAssets";

describe("canonical routed source assets", () => {
  it("uses chain-specific addresses and decimals for USDC and USDT", () => {
    expect(new Set(Object.keys(sourceAssetsByChain).map(Number))).toEqual(new Set([1, 56, 8453, 4663]));
    expect(requireSourceAsset(1, "USDC")).toMatchObject({ chainId: 1, decimals: 6 });
    expect(requireSourceAsset(56, "USDC")).toMatchObject({ chainId: 56, decimals: 18 });
    expect(requireSourceAsset(8453, "USDT")).toMatchObject({ chainId: 8453, decimals: 6 });
    expect(getSourceAssets(1).map(({ symbol }) => symbol)).toEqual(["USDC", "USDT"]);
  });

  it("does not accept a valid address from the wrong chain", () => {
    const ethereumUsdc = requireSourceAsset(1, "USDC");
    expect(() => requireSourceAssetDeployment(8453, ethereumUsdc.address)).toThrow(
      UnsupportedSourceAssetDeploymentError,
    );
  });

  it("fails closed where a canonical deployment has not been configured", () => {
    expect(getSourceAssets(4663)).toEqual([]);
    expect(() => requireSourceAsset(4663, "USDC")).toThrow(UnsupportedSourceAssetDeploymentError);
    expect(() => requireSourceAssetDeployment(
      4663,
      "0x0000000000000000000000000000000000000001",
    )).toThrow(UnsupportedSourceAssetDeploymentError);
  });
});
