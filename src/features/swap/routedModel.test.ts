import { describe, expect, it } from "vitest";

import { sameChainQuote, crossChainQuote, crossChainIntent } from "../../data/swapRouter/fixtures";
import { NATIVE_ASSET_ADDRESS } from "../../data/swapRouter/schema";
import { SwapRouterApiError } from "../../data/swapRouter/errors";
import { requireSourceAsset } from "../../config/sourceAssets";
import {
  buildRoutedSwapIntent,
  describeRouteSteps,
  formatRoutedDuration,
  formatRoutedGasEstimate,
  formatRoutedOutput,
  isNoRouteError,
  isSameChainQuote,
  quoteFresh,
  quoteSecondsRemaining,
  routedAmountError,
  routedQuoteRequestKey,
  routedSwapErrorMessage,
  summarizeRoutedFees,
} from "./routedModel";

const sourceUsdc = requireSourceAsset(56, "USDC");
const destinationMarket = {
  address: "0xAbC0000000000000000000000000000000000001",
  assetProvider: { id: "backed", name: "Backed" },
  chainId: 8453,
  name: "NVIDIA xStock",
  symbol: "NVDAx",
  underlying: { name: "NVIDIA xStock", symbol: "NVDA" },
} as const;

const draft = {
  amountAtomic: 25_000_000n,
  destinationMarket,
  sender: "0x4000000000000000000000000000000000000000",
  recipient: "0x4000000000000000000000000000000000000000",
  sourceAsset: sourceUsdc,
};

describe("buildRoutedSwapIntent", () => {
  it("targets the exact source deployment and destination market", () => {
    const intent = buildRoutedSwapIntent(draft);
    expect(intent).toEqual({
      amountIn: "25000000",
      destinationAsset: { address: "0xAbC0000000000000000000000000000000000001", chainId: 8453 },
      sender: "0x4000000000000000000000000000000000000000",
      recipient: "0x4000000000000000000000000000000000000000",
      slippageBps: 50,
      sourceAsset: { address: sourceUsdc.address, chainId: 56 },
    });
  });

  it("rejects a draft without a valid recipient or sender", () => {
    expect(() => buildRoutedSwapIntent({ ...draft, recipient: "0xnot-an-address" })).toThrow(/recipient/i);
    expect(() => buildRoutedSwapIntent({ ...draft, sender: "0xnot-an-address" })).toThrow(/sender/i);
  });
});

describe("routedQuoteRequestKey", () => {
  it("is stable and case-insensitive over addresses", () => {
    const key = routedQuoteRequestKey(draft);
    const same = routedQuoteRequestKey({
      ...draft,
      destinationMarket: { ...destinationMarket, address: "0xabc0000000000000000000000000000000000001" },
    });
    expect(key).toBe(same);
    expect(key).toContain("56:");
    expect(key).toContain(":8453:");
  });

  it("changes when any draft input changes", () => {
    const base = routedQuoteRequestKey(draft);
    expect(routedQuoteRequestKey({ ...draft, amountAtomic: 26_000_000n })).not.toBe(base);
    expect(routedQuoteRequestKey({ ...draft, recipient: "0x5000000000000000000000000000000000000000" })).not.toBe(base);
    expect(routedQuoteRequestKey({ ...draft, sourceAsset: requireSourceAsset(56, "USDT") })).not.toBe(base);
  });
});

describe("quote helpers", () => {
  it("detects same-chain and cross-chain quotes", () => {
    expect(isSameChainQuote(sameChainQuote)).toBe(true);
    expect(isSameChainQuote(crossChainQuote)).toBe(false);
  });

  it("computes freshness against a clock", () => {
    const expiresAt = Date.parse(crossChainQuote.expiresAt);
    expect(quoteFresh(crossChainQuote, expiresAt - 1)).toBe(true);
    expect(quoteFresh(crossChainQuote, expiresAt)).toBe(false);
    expect(quoteSecondsRemaining(crossChainQuote, expiresAt - 2_500)).toBe(3);
    expect(quoteSecondsRemaining(crossChainQuote, expiresAt + 1_000)).toBe(0);
  });

  it("formats output, gas, and duration", () => {
    expect(formatRoutedOutput(crossChainQuote.amountOut, 18)).toBe("24912.5");
    expect(formatRoutedGasEstimate("320000")).toBe("320,000 gas");
    expect(formatRoutedGasEstimate(undefined)).toBe("—");
    expect(formatRoutedDuration(15)).toBe("15s");
    expect(formatRoutedDuration(180)).toBe("3m");
    expect(formatRoutedDuration(185)).toBe("3m 5s");
    expect(formatRoutedDuration(undefined)).toBe("—");
  });
});

describe("fee and step descriptions", () => {
  const ETHEREUM_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const ETHEREUM_USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
  const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
  const resolveAsset = (asset: { address: string; chainId: number }) => {
    if (asset.address === ETHEREUM_USDC) return { decimals: 6, symbol: "USDC" };
    if (asset.address === NATIVE_ASSET_ADDRESS) return { decimals: 18, symbol: "ETH" };
    if (asset.address === ETHEREUM_USDT || asset.address === BSC_USDT) return { decimals: 18, symbol: "USDT" };
    return undefined;
  };
  const resolveChain = (chainId: number) => (chainId === 1 ? "Ethereum" : chainId === 56 ? "BNB Chain" : undefined);

  it("summarizes fees in the fee asset's units and flags unknown assets", () => {
    const lines = summarizeRoutedFees(crossChainQuote.fees, resolveAsset);
    expect(lines).toEqual([
      "0.00625 USDC protocol",
      "0.0025 USDC provider",
      "0.0042 ETH network",
    ]);
    const unknown = summarizeRoutedFees(
      [{ amount: "7", asset: { address: "0x9999999999999999999999999999999999999999", chainId: 1 }, kind: "liquidity" }],
      resolveAsset,
    );
    expect(unknown[0]).toContain("base units");
    expect(unknown[0]).toContain("0x9999…9999");
  });

  it("describes swap and bridge legs including the underlying bridge", () => {
    expect(describeRouteSteps(crossChainQuote.steps, resolveAsset, resolveChain)).toEqual([
      "Swap USDC for USDT on Ethereum",
      "Bridge USDT on Ethereum to USDT on BNB Chain",
    ]);
  });

  it("falls back to addresses and chain ids for unknown assets and chains", () => {
    const described = describeRouteSteps(crossChainQuote.steps, () => undefined, () => undefined);
    expect(described[0]).toContain("0xA0b8…eB48");
    expect(described[1]).toContain("chain 56");
  });
});

describe("amount validation", () => {
  it("reuses the shared decimal rules with the source asset's decimals", () => {
    expect(routedAmountError("", sourceUsdc)).toBe("Enter an amount");
    expect(routedAmountError("0", sourceUsdc)).toBe("Amount must be greater than zero");
    expect(routedAmountError("1.0000000000000000001", sourceUsdc)).toContain("decimal places");
    expect(routedAmountError("12.5", sourceUsdc)).toBeNull();
  });
});

describe("error mapping", () => {
  it("maps no-route envelopes to a single no-route state", () => {
    expect(isNoRouteError(new SwapRouterApiError("UNSUPPORTED_ROUTE", "no route", 422))).toBe(true);
    expect(isNoRouteError(new SwapRouterApiError("NO_QUOTES", "empty", 422))).toBe(true);
    expect(isNoRouteError(new SwapRouterApiError("NETWORK_ERROR", "down", 0))).toBe(false);
    expect(isNoRouteError(new Error("boom"))).toBe(false);
  });

  it("maps router and transport codes to actionable copy", () => {
    expect(routedSwapErrorMessage(new SwapRouterApiError("NO_QUOTES", "x", 422)))
      .toContain("No provider currently supports this route");
    expect(routedSwapErrorMessage(new SwapRouterApiError("QUOTE_EXPIRED", "x", 410)))
      .toContain("expired");
    expect(routedSwapErrorMessage(new SwapRouterApiError("NETWORK_ERROR", "x", 0)))
      .toContain("unreachable");
    expect(routedSwapErrorMessage(new Error("wallet boom"))).toBe("wallet boom");
    expect(routedSwapErrorMessage("mystery")).toContain("Something went wrong");
  });
});

describe("fixture alignment", () => {
  it("builds an intent that matches the cross-chain fixture identity", () => {
    const intent = buildRoutedSwapIntent({
      amountAtomic: BigInt(crossChainIntent.amountIn),
      destinationMarket: {
        address: crossChainIntent.destinationAsset.address,
        assetProvider: { id: "tether", name: "Tether" },
        chainId: 56,
        name: "Tether USD",
        symbol: "USDT",
        underlying: { symbol: "USDT" },
      },
      sender: crossChainIntent.sender,
      recipient: crossChainIntent.recipient,
      sourceAsset: requireSourceAsset(1, "USDC"),
    });
    expect(intent.amountIn).toBe(crossChainIntent.amountIn);
    expect(intent.destinationAsset).toEqual(crossChainIntent.destinationAsset);
    expect(intent.sourceAsset).toEqual(crossChainIntent.sourceAsset);
  });
});
