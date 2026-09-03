import { requireSourceAsset } from "../../config/sourceAssets";
import type { DestinationStockMarket } from "../../data/markets";
import { createRoutedSwapPlan } from "./routing";

const destinationMarket: DestinationStockMarket = {
  address: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9",
  assetProvider: { id: "robinhood", name: "Robinhood Assets (Jersey) Limited" },
  chainId: 4663,
  decimals: 18,
  issuerScaling: { kind: "erc-8056" },
  symbol: "AAPL",
  underlying: { name: "Apple Inc.", symbol: "AAPL" },
};

describe("routed swap plan", () => {
  it("derives distinct source and destination chains from their deployments", () => {
    const plan = createRoutedSwapPlan({
      destinationMarket,
      executionVenue: { id: "uniswap-v4", name: "Uniswap v4" },
      routeProvider: { id: "example-router", name: "Example Router" },
      sourceAsset: requireSourceAsset(8453, "USDC"),
    });

    expect(plan.sourceChainId).toBe(8453);
    expect(plan.destinationChainId).toBe(4663);
    expect(plan.destinationMarket.assetProvider.id).toBe("robinhood");
    expect(plan.routeProvider.id).toBe("example-router");
    expect(plan.executionVenue.id).toBe("uniswap-v4");
  });
});
