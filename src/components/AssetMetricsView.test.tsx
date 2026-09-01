import { render } from "@testing-library/react";

import { NetworkLogo, summarizeAssetMetrics } from "./AssetMetricsView";
import type { DeploymentDexMetrics } from "../data/assetMetrics";
import type { RwaAsset } from "../data/assets";
import { tokenMetadataKey, type TokenMetadata } from "../data/tokens";

function deployment(chainId: number, address: string): TokenMetadata {
  return {
    address,
    chainId,
    chainName: chainId === 1 ? "Ethereum" : "Solana",
    name: "Strategy PP Variable xStock",
    provider: "xstocks",
    symbol: "STRCx",
    underlyingSymbol: "STRC",
  };
}

describe("summarizeAssetMetrics", () => {
  it("uses the most-liquid deployment with a validated price", () => {
    const ethereum = deployment(1, "0x1aad217b8f78dba5e6693460e8470f8b1a3977f3");
    const solana = deployment(101, "Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH");
    const polygon = deployment(137, "0x3000000000000000000000000000000000000000");
    const asset: RwaAsset = {
      assetType: "equity",
      description: "",
      id: "xstocks:strc",
      logoURI: undefined,
      name: ethereum.name,
      provider: "xStocks",
      symbol: ethereum.symbol,
      tokens: [ethereum, solana, polygon],
      underlyingSymbol: "STRC",
    };
    const metric = (input: Partial<DeploymentDexMetrics>): DeploymentDexMetrics => ({
      liquidityUsd: 0,
      poolCount: 0,
      priceUsd: null,
      referencePrice: null,
      topVenue: null,
      volume24hUsd: 0,
      ...input,
    });
    const metrics = new Map([
      [tokenMetadataKey(ethereum.chainId, ethereum.address), metric({ liquidityUsd: 500_000 })],
      [tokenMetadataKey(solana.chainId, solana.address), metric({
        liquidityUsd: 194_576.68,
        poolCount: 1,
        priceUsd: 102.057,
        topVenue: "raydium",
        volume24hUsd: 3_527.85,
      })],
      [tokenMetadataKey(polygon.chainId, polygon.address), metric({})],
    ]);

    const summary = summarizeAssetMetrics(asset, metrics);
    expect(summary).toMatchObject({
      priceUsd: 102.057,
      volume24hUsd: 3_527.85,
    });
    expect(summary.liquidityUsd).toBeCloseTo(694_576.68);
    expect(summary.networks.map(({ chainId }) => chainId)).toEqual([1, 101]);
  });
});

describe("NetworkLogo", () => {
  it("renders the Base network logo", () => {
    const { container } = render(<NetworkLogo network={{ chainId: 8453, name: "Base" }} />);

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://icons.llamao.fi/icons/chains/rsz_base.jpg",
    );
  });
});
