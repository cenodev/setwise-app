import type { Hex } from "viem";

import {
  NATIVE_ASSET_ADDRESS,
  capabilitiesSchema,
  quoteListSchema,
  swapExecutionStatusSchema,
  swapIntentSchema,
  swapQuoteSchema,
  swapResponseSchema,
  type Capabilities,
  type QuoteList,
  type SwapExecutionStatus,
  type SwapIntent,
  type SwapQuote,
  type SwapResponse,
} from "./schema";

/**
 * Deterministic swap-router fixtures. Every value is fixed — addresses,
 * amounts, quote tokens, hashes, and timestamps — so app tests can exercise
 * routed swaps entirely offline against normalized responses. Valid fixtures
 * are parsed at import time, which keeps them provably aligned with the
 * contract schemas; malformed fixtures stay raw so boundary tests can feed
 * them through the client.
 */

export const FIXTURE_SENDER = "0x4000000000000000000000000000000000000000";
export const FIXTURE_EXECUTOR = "0x9000000000000000000000000000000000000009";
export const FIXTURE_TX_HASH: Hex = `0x${"ab".repeat(32)}`;

const BSC_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
const ETHEREUM_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ETHEREUM_USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

const PRICED_AT = "2026-07-19T12:00:00.000Z";
const EXPIRES_AT = "2026-07-19T12:05:00.000Z";

/** Same-chain: 25 BSC-USDC (18 decimals) to BSC-USDT, default 50 bps slippage. */
export const sameChainIntent: SwapIntent = swapIntentSchema.parse({
  sourceAsset: { chainId: 56, address: BSC_USDC },
  destinationAsset: { chainId: 56, address: BSC_USDT },
  amountIn: "25000000000000000000",
  recipient: FIXTURE_SENDER,
  slippageBps: 50,
});

export const sameChainQuote: SwapQuote = swapQuoteSchema.parse({
  quoteId: "fxq.same-chain-v1",
  providerId: "fixture",
  intent: sameChainIntent,
  amountOut: "24912500000000000000",
  minAmountOut: "24787937500000000000",
  fees: [
    { kind: "protocol", asset: sameChainIntent.sourceAsset, amount: "62500000000000000" },
    { kind: "provider", asset: sameChainIntent.sourceAsset, amount: "25000000000000000" },
  ],
  steps: [
    {
      kind: "swap",
      chainId: 56,
      fromAsset: sameChainIntent.sourceAsset,
      toAsset: sameChainIntent.destinationAsset,
    },
  ],
  estimatedGas: "185000",
  estimatedDurationSeconds: 15,
  expiresAt: EXPIRES_AT,
});

export const sameChainQuoteList: QuoteList = quoteListSchema.parse({ quotes: [sameChainQuote] });

export const sameChainPreparedSwap: SwapResponse = swapResponseSchema.parse({
  approval: {
    chainId: 56,
    owner: FIXTURE_SENDER,
    spender: FIXTURE_EXECUTOR,
    token: BSC_USDC,
    amount: sameChainIntent.amountIn,
  },
  transaction: {
    chainId: 56,
    to: FIXTURE_EXECUTOR,
    data: "0x6678712e73616d652d636861696e2d7631",
    value: "0",
    gas: "250000",
  },
  quote: sameChainQuote,
});

/** Cross-chain: 25 Ethereum USDC (6 decimals) to BSC-USDT via swap + bridge. */
export const crossChainIntent: SwapIntent = swapIntentSchema.parse({
  sourceAsset: { chainId: 1, address: ETHEREUM_USDC },
  destinationAsset: { chainId: 56, address: BSC_USDT },
  amountIn: "25000000",
  recipient: FIXTURE_SENDER,
  slippageBps: 50,
});

export const crossChainQuote: SwapQuote = swapQuoteSchema.parse({
  quoteId: "fxq.cross-chain-v1",
  providerId: "fixture",
  intent: crossChainIntent,
  amountOut: "24912500000000000000000",
  minAmountOut: "24787937500000000000000",
  fees: [
    { kind: "protocol", asset: crossChainIntent.sourceAsset, amount: "6250" },
    { kind: "provider", asset: crossChainIntent.sourceAsset, amount: "2500" },
    { kind: "network", asset: { chainId: 1, address: NATIVE_ASSET_ADDRESS }, amount: "4200000000000000" },
  ],
  steps: [
    {
      kind: "swap",
      chainId: 1,
      fromAsset: { chainId: 1, address: ETHEREUM_USDC },
      toAsset: { chainId: 1, address: ETHEREUM_USDT },
    },
    {
      kind: "bridge",
      chainId: 1,
      toChainId: 56,
      fromAsset: { chainId: 1, address: ETHEREUM_USDT },
      toAsset: { chainId: 56, address: BSC_USDT },
    },
  ],
  estimatedGas: "320000",
  estimatedDurationSeconds: 180,
  expiresAt: EXPIRES_AT,
});

export const crossChainQuoteList: QuoteList = quoteListSchema.parse({ quotes: [crossChainQuote] });

/** Full deployment capabilities for the four MVP allowlisted chains. */
export const swapRouterCapabilities: Capabilities = capabilitiesSchema.parse({
  service: "setwise-swap-router",
  apiVersion: "v1",
  version: "0.1.0",
  environment: "local",
  features: { exactInput: true, exactOutput: false, crossChainSwaps: true },
  chains: [
    { chainId: 1, name: "Ethereum", enabled: true, nativeAsset: { address: NATIVE_ASSET_ADDRESS, symbol: "ETH", decimals: 18 } },
    { chainId: 56, name: "BNB Chain", enabled: true, nativeAsset: { address: NATIVE_ASSET_ADDRESS, symbol: "BNB", decimals: 18 } },
    { chainId: 8453, name: "Base", enabled: true, nativeAsset: { address: NATIVE_ASSET_ADDRESS, symbol: "ETH", decimals: 18 } },
    { chainId: 4663, name: "Robinhood Chain", enabled: true, nativeAsset: { address: NATIVE_ASSET_ADDRESS, symbol: "ETH", decimals: 18 } },
  ],
  providers: [{ providerId: "fixture", enabled: true, status: "ready", chains: [1, 56, 8453, 4663] }],
});

/**
 * Partial-provider coverage: a second provider is registered but degraded, so
 * quote responses carry only the surviving provider's quote. The app must not
 * treat a short list as an error.
 */
export const partialProviderCapabilities: Capabilities = capabilitiesSchema.parse({
  ...swapRouterCapabilities,
  providers: [
    { providerId: "fixture", enabled: true, status: "ready", chains: [1, 56, 8453, 4663] },
    { providerId: "aggregator", enabled: true, status: "degraded", chains: [1, 56] },
  ],
});

export const partialProviderQuoteList: QuoteList = quoteListSchema.parse({ quotes: [crossChainQuote] });

/** No-route: every provider rejected the pair, surfaced as a 422 envelope. */
export const noRouteErrorEnvelope = {
  error: {
    code: "UNSUPPORTED_ROUTE",
    message: "no provider supports this route",
    requestId: "req-fixture-no-route",
  },
} as const;

/** Expired: the quote token outlived its TTL before preparation. */
export const expiredQuoteErrorEnvelope = {
  error: {
    code: "QUOTE_EXPIRED",
    message: "fixture quote has expired",
    requestId: "req-fixture-expired",
  },
} as const;

/** Malformed: syntactically broken payloads that must fail at the boundary. */
export const malformedQuoteListResponse = {
  quotes: [{ quoteId: "fxq.broken", providerId: "fixture" }],
} as const;

export const malformedStatusResponse = {
  status: {
    providerId: "fixture",
    quoteId: sameChainQuote.quoteId,
    intent: sameChainIntent,
    state: "mystery",
    transaction: null,
    detail: null,
    updatedAt: PRICED_AT,
  },
} as const;

const statusBase = {
  providerId: sameChainQuote.providerId,
  quoteId: sameChainQuote.quoteId,
  intent: sameChainIntent,
} as const;

const submittedTransaction = { chainId: 56, hash: FIXTURE_TX_HASH } as const;

export const pendingStatus: SwapExecutionStatus = swapExecutionStatusSchema.parse({
  ...statusBase,
  state: "pending",
  transaction: submittedTransaction,
  detail: null,
  updatedAt: "2026-07-19T12:01:00.000Z",
});

export const confirmedStatus: SwapExecutionStatus = swapExecutionStatusSchema.parse({
  ...statusBase,
  state: "confirmed",
  transaction: submittedTransaction,
  detail: null,
  updatedAt: "2026-07-19T12:02:00.000Z",
});

export const expiredStatus: SwapExecutionStatus = swapExecutionStatusSchema.parse({
  ...statusBase,
  state: "expired",
  transaction: null,
  detail: "Quote expired before submission",
  updatedAt: EXPIRES_AT,
});

export const refundedStatus: SwapExecutionStatus = swapExecutionStatusSchema.parse({
  ...statusBase,
  state: "refunded",
  transaction: submittedTransaction,
  detail: "Route failed after submission; the input was refunded to the sender",
  updatedAt: "2026-07-19T12:03:00.000Z",
});

export const failedStatus: SwapExecutionStatus = swapExecutionStatusSchema.parse({
  ...statusBase,
  state: "failed",
  transaction: submittedTransaction,
  detail: "Transaction reverted onchain",
  updatedAt: "2026-07-19T12:02:30.000Z",
});
