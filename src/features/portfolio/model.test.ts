import type { Address } from "viem";

import { formatDecimalRatio } from "../pool-analytics/model";
import {
  aggregatePublicTvl,
  aggregateUniqueExternalLiquidity,
  aggregateUserLiquidity,
  calculatePortfolioFreshness,
  calculateSetSharePercentage,
} from "./model";

const source = "0x1111111111111111111111111111111111111111" as Address;
const otherSource = "0x2222222222222222222222222222222222222222" as Address;

function state(totalValueUsd: string, atomicAmount: string, decimals: number) {
  return {
    totalSupply: { amount: "ignored", atomicAmount, decimals },
    totalValueUsd,
  };
}

describe("portfolio calculations", () => {
  it("sums healthy public Set TVL exactly while keeping partial failures visible", () => {
    const result = aggregatePublicTvl([
      { state: state("900719925474099312345678.000001", "1", 0), status: "ready" },
      { state: state("0.999999", "1", 0), status: "stale" },
      { status: "error" },
    ]);

    expect(result.status).toBe("partial");
    expect(result.coverage).toEqual({ available: 2, errors: 1, stale: 1, total: 3, unsupported: 0 });
    expect("value" in result && formatDecimalRatio(result.value, 6)).toBe("900719925474099312345679.000000");
  });

  it("aggregates user liquidity across Sets with different LP decimals", () => {
    const result = aggregateUserLiquidity([
      {
        attributedSharesAtomic: 500_000_000_000_000_000n,
        state: state("1000", "1000000000000000000", 18),
        status: "ready",
      },
      {
        attributedSharesAtomic: 500_000n,
        state: state("200", "2000000", 6),
        status: "ready",
      },
    ]);

    expect(result.status).toBe("ready");
    expect("value" in result && formatDecimalRatio(result.value, 2)).toBe("550.00");
  });

  it("does not silently turn unavailable user values into zero", () => {
    const partial = aggregateUserLiquidity([
      { attributedSharesAtomic: 1n, state: state("100", "10", 0), status: "ready" },
      { status: "error" },
    ]);
    expect(partial.status).toBe("partial");
    expect("value" in partial && formatDecimalRatio(partial.value, 2)).toBe("10.00");

    expect(aggregateUserLiquidity([
      { attributedSharesAtomic: 1n, state: state("0", "10", 0), status: "ready" },
    ]).status).toBe("error");
    expect(aggregateUserLiquidity([
      { attributedSharesAtomic: 1n, state: state("100", "0", 18), status: "ready" },
    ]).status).toBe("error");
  });

  it("returns explicit disconnected, unsupported, and zero-balance aggregates", () => {
    expect(aggregateUserLiquidity([{ status: "disconnected" }, { status: "disconnected" }]).status)
      .toBe("disconnected");
    expect(aggregateUserLiquidity([{ status: "disconnected" }, { status: "unsupported-chain" }]).status)
      .toBe("disconnected");
    expect(aggregateUserLiquidity([{ status: "unsupported-chain" }]).status).toBe("unsupported-chain");
    expect(aggregateUserLiquidity([
      { attributedSharesAtomic: 0n, state: state("100", "10", 0), status: "zero-balance" },
    ]).status).toBe("zero-balance");
  });

  it("calculates a Set share percentage without floating-point conversion", () => {
    const total = aggregatePublicTvl([
      { state: state("999999999999999999999999999999", "1", 0), status: "ready" },
      { state: state("1", "1", 0), status: "ready" },
    ]);
    if (!("value" in total)) throw new Error("Expected public TVL");
    const share = calculateSetSharePercentage({ numerator: 1n, denominator: 1n }, total.value);
    expect(share.status).toBe("available");
    if (share.status !== "available") throw new Error("Expected a share percentage");
    expect(formatDecimalRatio(share.value, 32)).toBe("0.00000000000000000000000000010000");
  });

  it("deduplicates external liquidity by chain, venue, and source address", () => {
    const result = aggregateUniqueExternalLiquidity([
      [{ chainId: 97, venue: "PancakeSwap", sourceAddress: source, liquidityUsd: "100", observedAt: "2026-07-21T10:00:00.000Z" }],
      [
        { chainId: 97, venue: "pancakeswap", sourceAddress: source, liquidityUsd: "120", observedAt: "2026-07-21T10:01:00.000Z" },
        { chainId: 56, venue: "PancakeSwap", sourceAddress: otherSource, liquidityUsd: "30.5" },
      ],
    ]);

    expect(result.sources).toHaveLength(2);
    expect(formatDecimalRatio(result.totalValueUsd, 2)).toBe("150.50");
  });

  it("reports freshness across different snapshot times", () => {
    const result = calculatePortfolioFreshness([
      "2026-07-21T10:00:00.000Z",
      "2026-07-21T10:01:50.000Z",
      null,
    ], Date.parse("2026-07-21T10:02:00.000Z"), 60_000);

    expect(result).toEqual({
      newestTimestamp: "2026-07-21T10:01:50.000Z",
      oldestTimestamp: "2026-07-21T10:00:00.000Z",
      stale: 1,
      status: "partial",
      total: 3,
    });
  });
});
