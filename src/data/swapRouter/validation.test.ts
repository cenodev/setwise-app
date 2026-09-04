import type { Address } from "viem";

import { NATIVE_ASSET_ADDRESS, type SwapQuote, type SwapResponse } from "./schema";
import {
  assertPreparedSwapPreservesQuote,
  assertQuotePreservesIntent,
  assertStatusPreservesQuote,
} from "./validation";
import {
  FIXTURE_DESTINATION_HASH,
  FIXTURE_TX_HASH,
  confirmedStatus,
  confirmedWithDestinationStatus,
  crossChainIntent,
  crossChainQuote,
  destinationMismatchedStatus,
  expiredStatus,
  failedStatus,
  partiallyDeliveredStatus,
  pendingStatus,
  refundedStatus,
  sameChainIntent,
  sameChainPreparedSwap,
  sameChainQuote,
} from "./fixtures";

const mismatched = { code: "RESPONSE_MISMATCH" };
const otherWallet = "0x5000000000000000000000000000000000000005" as Address;
const otherToken = "0x6000000000000000000000000000000000000006" as Address;

function echoIntent(quote: SwapQuote, intent: Partial<SwapQuote["intent"]>): SwapQuote {
  return { ...quote, intent: { ...quote.intent, ...intent } };
}

describe("assertQuotePreservesIntent", () => {
  it("accepts the same-chain and cross-chain fixtures", () => {
    expect(() => assertQuotePreservesIntent(sameChainQuote, sameChainIntent)).not.toThrow();
    expect(() => assertQuotePreservesIntent(crossChainQuote, crossChainIntent)).not.toThrow();
  });

  it.each([
    ["a different source chain", echoIntent(sameChainQuote, { sourceAsset: { ...sameChainIntent.sourceAsset, chainId: 1 } })],
    ["a different source token", echoIntent(sameChainQuote, { sourceAsset: { chainId: 56, address: sameChainIntent.destinationAsset.address } })],
    ["a different destination chain", echoIntent(sameChainQuote, { destinationAsset: { ...sameChainIntent.destinationAsset, chainId: 8453 } })],
    ["a different destination token", echoIntent(sameChainQuote, { destinationAsset: { chainId: 56, address: sameChainIntent.sourceAsset.address } })],
    ["a different input amount", echoIntent(sameChainQuote, { amountIn: "1" })],
    ["a different sender", echoIntent(sameChainQuote, { sender: otherWallet })],
    ["a different recipient", echoIntent(sameChainQuote, { recipient: otherWallet })],
    ["a different slippage", echoIntent(sameChainQuote, { slippageBps: 100 })],
    ["an inverted route", { ...sameChainQuote, steps: [{ ...sameChainQuote.steps[0], fromAsset: sameChainIntent.destinationAsset, toAsset: sameChainIntent.sourceAsset }] }],
    ["a route ending elsewhere", { ...sameChainQuote, steps: [{ ...sameChainQuote.steps[0], toAsset: { chainId: 56, address: otherToken } }] }],
    ["minAmountOut above amountOut", { ...sameChainQuote, minAmountOut: sameChainQuote.amountOut.replace(/^2/, "9") }],
  ])("rejects %s", (_name, quote) => {
    expect(() => assertQuotePreservesIntent(quote, sameChainIntent)).toThrowError(expect.objectContaining(mismatched));
  });
});

describe("assertPreparedSwapPreservesQuote", () => {
  it("accepts the same-chain prepared swap fixture", () => {
    expect(() => assertPreparedSwapPreservesQuote(sameChainPreparedSwap, sameChainQuote)).not.toThrow();
  });

  const { approval, transaction } = sameChainPreparedSwap;
  if (approval === null) throw new Error("fixture must include an approval");

  it.each([
    ["a different quote id", { ...sameChainPreparedSwap, quote: { ...sameChainQuote, quoteId: "fxq.other" } }],
    ["a different provider id", { ...sameChainPreparedSwap, quote: { ...sameChainQuote, providerId: "aggregator" } }],
    ["different quoted amounts", { ...sameChainPreparedSwap, quote: { ...sameChainQuote, amountOut: "1" } }],
    ["a missing approval", { ...sameChainPreparedSwap, approval: null }],
    ["an approval on another chain", { ...sameChainPreparedSwap, approval: { ...approval, chainId: 1 } }],
    ["an approval for another token", { ...sameChainPreparedSwap, approval: { ...approval, token: sameChainIntent.destinationAsset.address } }],
    ["an approval for another owner", { ...sameChainPreparedSwap, approval: { ...approval, owner: otherWallet } }],
    ["an approval below the input amount", { ...sameChainPreparedSwap, approval: { ...approval, amount: "1" } }],
    ["a transaction on another chain", { ...sameChainPreparedSwap, transaction: { ...transaction, chainId: 1 } }],
    ["a transaction carrying native value", { ...sameChainPreparedSwap, transaction: { ...transaction, value: "1" } }],
  ])("rejects %s", (_name, response: SwapResponse) => {
    expect(() => assertPreparedSwapPreservesQuote(response, sameChainQuote)).toThrowError(expect.objectContaining(mismatched));
  });

  const nativeIntent = {
    ...sameChainIntent,
    sourceAsset: { chainId: 56, address: NATIVE_ASSET_ADDRESS },
  };
  const nativeQuote: SwapQuote = {
    ...sameChainQuote,
    intent: nativeIntent,
    steps: [{ kind: "swap", chainId: 56, fromAsset: nativeIntent.sourceAsset, toAsset: nativeIntent.destinationAsset }],
  };
  const nativePrepared: SwapResponse = {
    approval: null,
    transaction: { ...transaction, value: nativeIntent.amountIn },
    quote: nativeQuote,
  };

  it("accepts a native-input preparation with matching value", () => {
    expect(() => assertPreparedSwapPreservesQuote(nativePrepared, nativeQuote)).not.toThrow();
  });

  it.each([
    ["an approval for a native source", { ...nativePrepared, approval }],
    ["native value below the input amount", { ...nativePrepared, transaction: { ...nativePrepared.transaction, value: "1" } }],
  ])("rejects %s", (_name, response: SwapResponse) => {
    expect(() => assertPreparedSwapPreservesQuote(response, nativeQuote)).toThrowError(expect.objectContaining(mismatched));
  });
});

describe("assertStatusPreservesQuote", () => {
  it.each([
    ["pending", pendingStatus, sameChainQuote],
    ["confirmed", confirmedStatus, sameChainQuote],
    ["confirmed with destination evidence", confirmedWithDestinationStatus, crossChainQuote],
    ["partially delivered", partiallyDeliveredStatus, sameChainQuote],
    ["expired", expiredStatus, sameChainQuote],
    ["refunded", refundedStatus, sameChainQuote],
    ["failed", failedStatus, sameChainQuote],
  ])("accepts the %s status fixture", (_name, status, quote) => {
    expect(() => assertStatusPreservesQuote(status, quote)).not.toThrow();
  });

  it("accepts destination evidence only for the exact destination chain", () => {
    expect(() => assertStatusPreservesQuote({
      ...confirmedWithDestinationStatus,
      destinationTransaction: null,
    }, crossChainQuote)).not.toThrow();
    expect(() => assertStatusPreservesQuote({
      ...confirmedWithDestinationStatus,
      destinationTransaction: undefined,
    }, crossChainQuote)).not.toThrow();
  });

  it.each([
    ["a different quote id", { ...pendingStatus, quoteId: "fxq.other" }],
    ["a different provider id", { ...pendingStatus, providerId: "aggregator" }],
    ["a different recipient", { ...pendingStatus, intent: { ...pendingStatus.intent, recipient: otherWallet } }],
    ["a different input amount", { ...pendingStatus, intent: { ...pendingStatus.intent, amountIn: "1" } }],
    ["a transaction on another chain", { ...pendingStatus, transaction: { chainId: 1, hash: FIXTURE_TX_HASH } }],
    ["destination evidence on another chain", destinationMismatchedStatus],
    ["destination evidence for the wrong asset", {
      ...confirmedWithDestinationStatus,
      destinationTransaction: { chainId: 1, hash: FIXTURE_DESTINATION_HASH },
    }],
  ])("rejects %s", (_name, status) => {
    expect(() => assertStatusPreservesQuote(status, sameChainQuote)).toThrowError(expect.objectContaining(mismatched));
  });

  it("accepts destination evidence matching the cross-chain destination", () => {
    expect(() => assertStatusPreservesQuote(confirmedWithDestinationStatus, crossChainQuote)).not.toThrow();
    expect(() => assertStatusPreservesQuote({
      ...confirmedWithDestinationStatus,
      destinationTransaction: null,
    }, crossChainQuote)).not.toThrow();
    expect(() => assertStatusPreservesQuote({
      ...confirmedWithDestinationStatus,
      destinationTransaction: undefined,
    }, crossChainQuote)).not.toThrow();
  });
});
