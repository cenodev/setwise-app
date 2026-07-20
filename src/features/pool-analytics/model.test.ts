import { poolStateSchema } from "../../data/rfq/deposits";
import {
  calculateCurrentAssetAllocation,
  calculateLpSharePrice,
  calculateMidpointMarketPrice,
  calculateOwnershipPercentage,
  calculatePoolTvl,
  calculateTargetAllocationVariance,
  calculateUserLiquidityValue,
  calculateWalletAssetUsdValue,
  formatDecimalRatio,
} from "./model";

const state = poolStateSchema.parse({
  poolId: "pool",
  chainId: 97,
  poolAddress: "0x1111111111111111111111111111111111111111",
  blockNumber: "120266420",
  blockTimestamp: "2026-07-20T16:30:31.000Z",
  trading: { paused: false, deposits: "available" },
  totalValueUsd: "1000.01",
  totalSupply: { amount: "400.004", atomicAmount: "400004000000000000000", decimals: 18 },
  assets: [{
    asset: "USDT", amount: "400", atomicAmount: "400000000", decimals: 6,
    index: 0, recordedAtomicBalance: "400000000", actualAtomicBalance: "400000000",
    balanceStatus: "synced", multiplier: "1", valueUsd: "400.004",
    market: { bidUsd: "1.0001", askUsd: "1.0003", observedAt: "2026-07-20T16:30:34.251Z" },
  }],
});

function expectAvailable(result: ReturnType<typeof calculateLpSharePrice>) {
  if (result.status === "unavailable") throw new Error(`Expected an available calculation, got ${result.reason}`);
  return result.value;
}

describe("pool analytics calculations", () => {
  it("uses exact ratios for TVL, LP price, and allocation", () => {
    expect(formatDecimalRatio(calculatePoolTvl(state), 2)).toBe("1000.01");
    expect(formatDecimalRatio(expectAvailable(calculateLpSharePrice(state)), 6)).toBe("2.500000");
    expect(formatDecimalRatio(expectAvailable(calculateCurrentAssetAllocation(state.assets[0], state)), 8)).toBe("0.40000000");
    expect(formatDecimalRatio(expectAvailable(calculateTargetAllocationVariance(state.assets[0], state, 35)), 2)).toBe("5.00");
    expect(formatDecimalRatio(calculateMidpointMarketPrice(state.assets[0].market), 4)).toBe("1.0002");
  });

  it("retains tiny ownership percentages and large atomic balances", () => {
    const ownership = expectAvailable(calculateOwnershipPercentage(1n, {
      atomicAmount: "1000000000000000000000000000000", decimals: 18,
    }));
    expect(formatDecimalRatio(ownership, 32)).toBe("0.00000000000000000000000000010000");

    const walletValue = calculateWalletAssetUsdValue({
      balanceAtomic: 123456789123456789123456789n,
      tokenDecimals: 18,
      market: state.assets[0].market,
    });
    expect(formatDecimalRatio(walletValue, 4)).toBe("123481480.4813");
  });

  it("calculates user liquidity value and rounds only for display", () => {
    const value = expectAvailable(calculateUserLiquidityValue({
      attributedSharesAtomic: 1n,
      state: {
        totalValueUsd: "1",
        totalSupply: { amount: "3", atomicAmount: "3", decimals: 0 },
      },
    }));
    expect(formatDecimalRatio(value, 2)).toBe("0.33");
    expect(formatDecimalRatio(value, 2, "down")).toBe("0.33");
  });

  it("returns unavailable results for zero TVL or LP supply", () => {
    expect(calculateCurrentAssetAllocation(state.assets[0], { totalValueUsd: "0" }))
      .toEqual({ status: "unavailable", reason: "zero-tvl" });
    expect(calculateLpSharePrice({ ...state, totalValueUsd: "0" }))
      .toEqual({ status: "unavailable", reason: "zero-tvl" });
    expect(calculateLpSharePrice({
      totalValueUsd: "1",
      totalSupply: { amount: "0", atomicAmount: "0", decimals: 18 },
    })).toEqual({ status: "unavailable", reason: "zero-total-supply" });
  });

  it("keeps display rounding separate from the calculation", () => {
    const price = calculateWalletAssetUsdValue({
      balanceAtomic: 1n,
      tokenDecimals: 0,
      market: { bidUsd: "1.235", askUsd: "1.236" },
    });
    expect(formatDecimalRatio(price, 2)).toBe("1.24");
    expect(formatDecimalRatio(price, 2, "down")).toBe("1.23");
    expect(formatDecimalRatio(price, 3)).toBe("1.236");
  });
});
