import { describe, expect, it } from "vitest";
import type { Address } from "viem";

import {
  crossChainQuote,
  sameChainIntent,
  sameChainPreparedSwap,
  sameChainQuote,
} from "../../data/swapRouter/fixtures";
import {
  swapResponseSchema,
  type SwapExecutionStatus,
  type SwapQuote,
  type SwapResponse,
} from "../../data/swapRouter/schema";
import {
  assertRoutedExecutionWindow,
  buildRoutedSubmission,
  isWalletRejection,
  mapExecutionStatus,
  revalidateReviewedQuote,
  routedExecutionBusy,
  routedExecutionErrorMessage,
  routedRecoveryGuidance,
  routedSimulationErrorMessage,
} from "./routedExecution";

const wallet = sameChainIntent.recipient;
const otherWallet = "0x5000000000000000000000000000000000000005" as Address;
const now = Date.parse(sameChainQuote.expiresAt) - 60_000;

function expired(quote: SwapQuote): SwapQuote {
  return { ...quote, expiresAt: new Date(now - 1_000).toISOString() };
}

describe("assertRoutedExecutionWindow", () => {
  const base = {
    expectedAccount: wallet,
    expectedChainId: 56,
    now,
    quote: sameChainQuote,
  };

  it("accepts an unchanged connected wallet on the source chain", () => {
    expect(() => assertRoutedExecutionWindow({
      ...base,
      snapshot: { account: wallet, chainId: 56, online: true },
    })).not.toThrow();
  });

  it.each([
    ["offline", { account: wallet, chainId: 56, online: false }],
    ["a changed account", { account: otherWallet, chainId: 56, online: true }],
    ["a disconnected account", { account: undefined, chainId: 56, online: true }],
    ["a changed chain", { account: wallet, chainId: 1, online: true }],
    ["an unknown chain", { account: wallet, chainId: undefined, online: true }],
  ] as const)("blocks %s", (_name, snapshot) => {
    expect(() => assertRoutedExecutionWindow({ ...base, snapshot })).toThrow(Error);
  });

  it("blocks an expired quote", () => {
    expect(() => assertRoutedExecutionWindow({
      ...base,
      quote: expired(sameChainQuote),
      snapshot: { account: wallet, chainId: 56, online: true },
    })).toThrow(/expired/i);
  });
});

describe("revalidateReviewedQuote", () => {
  it("returns the fresh quote when the reviewed route is still offered unchanged", () => {
    const fresh = { ...sameChainQuote, expiresAt: new Date(now + 120_000).toISOString() };
    expect(revalidateReviewedQuote({ freshQuotes: [fresh], now, reviewed: sameChainQuote })).toBe(fresh);
  });

  it("accepts a rotated quoteId when the router re-issues identical economics", () => {
    const rotated = {
      ...sameChainQuote,
      quoteId: "lfq.rotated-router-id",
      expiresAt: new Date(now + 120_000).toISOString(),
    };
    expect(revalidateReviewedQuote({ freshQuotes: [rotated], now, reviewed: sameChainQuote })).toBe(rotated);
  });

  it("blocks when the reviewed route is no longer offered", () => {
    expect(() => revalidateReviewedQuote({ freshQuotes: [], now, reviewed: sameChainQuote }))
      .toThrow(/no longer offered/i);
  });

  it("blocks when the only matching route has different economics", () => {
    const different = { ...sameChainQuote, quoteId: "fxq.other", amountOut: "1" };
    expect(() => revalidateReviewedQuote({ freshQuotes: [different], now, reviewed: sameChainQuote }))
      .toThrow(/no longer offered/i);
  });

  it("blocks when the only fresh response expired", () => {
    expect(() => revalidateReviewedQuote({ freshQuotes: [expired(sameChainQuote)], now, reviewed: sameChainQuote }))
      .toThrow(/expired/i);
  });

  it.each([
    ["a different provider", { ...sameChainQuote, providerId: "aggregator" }],
    ["a different output", { ...sameChainQuote, amountOut: "1" }],
    ["a different minimum output", { ...sameChainQuote, minAmountOut: "1" }],
    ["a different input amount", { ...sameChainQuote, intent: { ...sameChainIntent, amountIn: "1" } }],
    ["a different recipient", { ...sameChainQuote, intent: { ...sameChainIntent, recipient: otherWallet } }],
    ["a different sender", { ...sameChainQuote, intent: { ...sameChainIntent, sender: otherWallet } }],
    ["a different slippage", { ...sameChainQuote, intent: { ...sameChainIntent, slippageBps: 100 } }],
  ] as const)("blocks a mismatched re-issued quote: %s", (_name, fresh) => {
    expect(() => revalidateReviewedQuote({ freshQuotes: [fresh], now, reviewed: sameChainQuote }))
      .toThrow(/changed while revalidating/i);
  });
});

describe("buildRoutedSubmission", () => {
  it("builds the wallet submission with the exact normalized approval", () => {
    const submission = buildRoutedSubmission({ account: wallet, prepared: sameChainPreparedSwap });
    expect(submission).toEqual({
      account: wallet,
      approval: {
        amount: BigInt(sameChainIntent.amountIn),
        owner: wallet,
        spender: sameChainPreparedSwap.transaction.to,
        token: sameChainIntent.sourceAsset.address,
      },
      chainId: 56,
      data: sameChainPreparedSwap.transaction.data,
      gas: 250_000n,
      to: sameChainPreparedSwap.transaction.to,
      value: 0n,
    });
  });

  it("accepts a native-input submission without approval and exact value", () => {
    const nativeIntent = {
      ...sameChainIntent,
      sourceAsset: { chainId: 56, address: "0x0000000000000000000000000000000000000000" as const },
    };
    const nativeQuote: SwapQuote = {
      ...sameChainQuote,
      intent: nativeIntent,
      steps: [{
        kind: "swap",
        chainId: 56,
        fromAsset: nativeIntent.sourceAsset,
        toAsset: nativeIntent.destinationAsset,
      }],
    };
    const prepared: SwapResponse = {
      approval: null,
      transaction: { ...sameChainPreparedSwap.transaction, value: nativeIntent.amountIn },
      quote: nativeQuote,
    };
    expect(buildRoutedSubmission({ account: wallet, prepared })).toEqual(expect.objectContaining({
      approval: null,
      value: BigInt(nativeIntent.amountIn),
    }));
    expect(() => buildRoutedSubmission({
      account: wallet,
      prepared: { ...prepared, approval: sameChainPreparedSwap.approval },
    })).toThrow(/must not require/i);
  });

  it("rejects a prepared transaction that drifts off the reviewed quote chain", () => {
    const prepared = swapResponseSchema.parse({
      ...sameChainPreparedSwap,
      approval: {
        chainId: 1,
        amount: crossChainIntentAmount(),
        owner: crossChainQuote.intent.recipient,
        spender: sameChainPreparedSwap.transaction.to,
        token: crossChainQuote.intent.sourceAsset.address,
      },
      quote: crossChainQuote,
    });
    expect(() => buildRoutedSubmission({ account: wallet, prepared })).toThrow(/different chain/i);
  });

  it.each([
    ["a different sender", (response: SwapResponse): SwapResponse => response, otherWallet],
    ["an inflated approval", (response: SwapResponse): SwapResponse => ({
      ...response,
      approval: { ...response.approval, amount: "999999999999999999999" } as NonNullable<SwapResponse["approval"]>,
    }), wallet],
    ["an approval for a different spender", (response: SwapResponse): SwapResponse => ({
      ...response,
      approval: {
        ...response.approval,
        spender: "0x7000000000000000000000000000000000000007",
      } as NonNullable<SwapResponse["approval"]>,
    }), wallet],
    ["an approval for another token", (response: SwapResponse): SwapResponse => ({
      ...response,
      approval: {
        ...response.approval,
        token: sameChainIntent.destinationAsset.address,
      } as NonNullable<SwapResponse["approval"]>,
    }), wallet],
    ["an approval for another owner", (response: SwapResponse): SwapResponse => ({
      ...response,
      approval: { ...response.approval, owner: otherWallet } as NonNullable<SwapResponse["approval"]>,
    }), wallet],
    ["a transaction carrying native value", (response: SwapResponse): SwapResponse => ({
      ...response,
      transaction: { ...response.transaction, value: "1" },
    }), wallet],
  ])("rejects %s", (_name, mutate, account) => {
    expect(() => buildRoutedSubmission({ account, prepared: mutate(sameChainPreparedSwap) })).toThrow(Error);
  });
});

function crossChainIntentAmount(): string {
  return crossChainQuote.intent.amountIn;
}

describe("mapExecutionStatus", () => {
  function statusFixture(state: SwapExecutionStatus["state"]) {
    return {
      providerId: sameChainQuote.providerId,
      quoteId: sameChainQuote.quoteId,
      intent: sameChainIntent,
      state,
      transaction: { chainId: 56, hash: `0x${"ab".repeat(32)}` as const },
      destinationTransaction: { chainId: 56, hash: `0x${"cd".repeat(32)}` as const },
      detail: null,
      updatedAt: new Date().toISOString(),
    } as const;
  }

  it("treats confirmed as the only full-delivery state and carries destination evidence", () => {
    expect(mapExecutionStatus(statusFixture("confirmed"))).toEqual({
      detail: null,
      destinationHash: `0x${"cd".repeat(32)}`,
      kind: "terminal",
      lifecycle: "delivered",
    });
  });

  it.each([
    ["partially-delivered", "partially_delivered"],
    ["refunded", "refunded"],
    ["failed", "failed"],
    ["unknown", "expired"],
  ] as const)("maps %s provider state without receipt claims", (lifecycle, state) => {
    expect(mapExecutionStatus(statusFixture(state))).toEqual(
      expect.objectContaining({ kind: "terminal", lifecycle }),
    );
  });

  it("keeps pending non-terminal", () => {
    expect(mapExecutionStatus(statusFixture("pending"))).toEqual(
      expect.objectContaining({ kind: "pending", lifecycle: "destination-pending" }),
    );
  });
});

describe("stage and guidance helpers", () => {
  it("marks only in-flight stages as busy", () => {
    expect(routedExecutionBusy("wallet")).toBe(true);
    expect(routedExecutionBusy("tracking")).toBe(true);
    expect(routedExecutionBusy("delivered")).toBe(false);
    expect(routedExecutionBusy("rejected")).toBe(false);
  });

  it("gives recovery guidance that never claims receipt for non-delivered outcomes", () => {
    expect(routedRecoveryGuidance("delivered")).toMatch(/delivered the destination token/i);
    expect(routedRecoveryGuidance("partially-delivered")).toMatch(/only part/i);
    expect(routedRecoveryGuidance("refunded")).toMatch(/refunded/i);
    expect(routedRecoveryGuidance("failed")).toMatch(/no destination tokens were delivered/i);
    expect(routedRecoveryGuidance("unknown")).toMatch(/could not confirm settlement/i);
  });

  it("detects wallet rejections for honest stage reporting", () => {
    expect(isWalletRejection(new Error("User rejected the request"))).toBe(true);
    expect(isWalletRejection(new Error("execution reverted"))).toBe(false);
    expect(routedExecutionErrorMessage(new Error("User rejected the request"))).toMatch(/nothing was submitted/i);
  });

  it("maps simulation failures to actionable copy", () => {
    expect(routedSimulationErrorMessage(new Error("insufficient funds for gas"))).toMatch(/insufficient funds/i);
    expect(routedSimulationErrorMessage(new Error("ERC20: insufficient allowance"))).toMatch(/allowance/i);
    expect(routedSimulationErrorMessage(new Error("HTTP request failed"))).toMatch(/simulate/i);
    expect(routedSimulationErrorMessage(new Error("swap slippage"))).toMatch(/simulation failed/i);
  });
});
