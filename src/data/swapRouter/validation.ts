import { isAddressEqual } from "viem";

import { SwapRouterApiError, swapRouterClientErrorCodes } from "./errors";
import {
  NATIVE_ASSET_ADDRESS,
  type AssetReference,
  type SwapExecutionStatus,
  type SwapIntent,
  type SwapQuote,
  type SwapResponse,
} from "./schema";

/**
 * Fail-closed identity validation for swap-router responses. A syntactically
 * valid response is still rejected unless it preserves the requested chains,
 * chain-qualified token addresses, sender/recipient, and exact input amount.
 * Every mismatch throws RESPONSE_MISMATCH so routed swaps never execute
 * against a quote for different money than the user reviewed.
 */

function mismatch(message: string): SwapRouterApiError {
  return new SwapRouterApiError(swapRouterClientErrorCodes.responseMismatch, message, 200);
}

function assetsEqual(a: AssetReference, b: AssetReference): boolean {
  return a.chainId === b.chainId && isAddressEqual(a.address, b.address);
}

function assertIntentEcho(echoed: SwapIntent, requested: SwapIntent, subject: string): void {
  if (!assetsEqual(echoed.sourceAsset, requested.sourceAsset)) {
    throw mismatch(`${subject} does not preserve the requested source asset`);
  }
  if (!assetsEqual(echoed.destinationAsset, requested.destinationAsset)) {
    throw mismatch(`${subject} does not preserve the requested destination asset`);
  }
  if (BigInt(echoed.amountIn) !== BigInt(requested.amountIn)) {
    throw mismatch(`${subject} does not preserve the exact input amount`);
  }
  if (!isAddressEqual(echoed.sender, requested.sender)) {
    throw mismatch(`${subject} does not preserve the requested sender`);
  }
  if (!isAddressEqual(echoed.recipient, requested.recipient)) {
    throw mismatch(`${subject} does not preserve the requested recipient`);
  }
  if (echoed.slippageBps !== requested.slippageBps) {
    throw mismatch(`${subject} does not preserve the requested slippage`);
  }
}

function isNativeSource(intent: SwapIntent): boolean {
  return isAddressEqual(intent.sourceAsset.address, NATIVE_ASSET_ADDRESS);
}

/** Validates that a normalized quote answers the exact intent that was requested. */
export function assertQuotePreservesIntent(quote: SwapQuote, intent: SwapIntent): void {
  assertIntentEcho(quote.intent, intent, "Quote");
  if (quote.steps[0] === undefined || !assetsEqual(quote.steps[0].fromAsset, intent.sourceAsset)) {
    throw mismatch("Quote route does not start from the requested source asset");
  }
  const lastStep = quote.steps[quote.steps.length - 1];
  if (lastStep === undefined || !assetsEqual(lastStep.toAsset, intent.destinationAsset)) {
    throw mismatch("Quote route does not end at the requested destination asset");
  }
  if (BigInt(quote.minAmountOut) > BigInt(quote.amountOut)) {
    throw mismatch("Quote minimum output exceeds its expected output");
  }
}

/**
 * Validates that a prepared swap executes the exact quote the user selected:
 * same opaque quote identity, same echoed economics, an approval scoped to the
 * requested source token and sender, and a transaction on the source chain
 * carrying value only for native inputs.
 */
export function assertPreparedSwapPreservesQuote(response: SwapResponse, quote: SwapQuote): void {
  const echoed = response.quote;
  if (echoed.quoteId !== quote.quoteId || echoed.providerId !== quote.providerId) {
    throw mismatch("Prepared swap does not preserve the selected quote identity");
  }
  assertQuotePreservesIntent(echoed, quote.intent);
  if (BigInt(echoed.amountOut) !== BigInt(quote.amountOut) || BigInt(echoed.minAmountOut) !== BigInt(quote.minAmountOut)) {
    throw mismatch("Prepared swap does not preserve the quoted output amounts");
  }

  const { intent } = quote;
  const { approval, transaction } = response;
  if (transaction.chainId !== intent.sourceAsset.chainId) {
    throw mismatch("Prepared transaction targets a different chain than the source asset");
  }
  if (isNativeSource(intent)) {
    if (approval !== null) {
      throw mismatch("Native source swaps must not require an ERC-20 approval");
    }
    if (BigInt(transaction.value) !== BigInt(intent.amountIn)) {
      throw mismatch("Prepared transaction value does not equal the exact native input amount");
    }
    return;
  }
  if (approval === null) {
    throw mismatch("Token source swaps must include the ERC-20 approval");
  }
  if (approval.chainId !== intent.sourceAsset.chainId) {
    throw mismatch("Approval targets a different chain than the source asset");
  }
  if (!isAddressEqual(approval.token, intent.sourceAsset.address)) {
    throw mismatch("Approval does not cover the requested source token");
  }
  if (!isAddressEqual(approval.owner, intent.sender)) {
    throw mismatch("Approval owner does not match the swap sender");
  }
  if (BigInt(approval.amount) < BigInt(intent.amountIn)) {
    throw mismatch("Approval amount is below the exact input amount");
  }
  if (BigInt(transaction.value) !== 0n) {
    throw mismatch("Token source swaps must not carry native value");
  }
}

/** Validates that an execution status reports on the quote being tracked. */
export function assertStatusPreservesQuote(status: SwapExecutionStatus, quote: SwapQuote): void {
  if (status.quoteId !== quote.quoteId || status.providerId !== quote.providerId) {
    throw mismatch("Execution status does not preserve the tracked quote identity");
  }
  assertIntentEcho(status.intent, quote.intent, "Execution status");
  if (status.transaction !== null && status.transaction.chainId !== quote.intent.sourceAsset.chainId) {
    throw mismatch("Execution status transaction targets a different chain than the source asset");
  }
  if (status.destinationTransaction != null
    && status.destinationTransaction.chainId !== quote.intent.destinationAsset.chainId) {
    throw mismatch("Execution status destination transaction targets a different chain than the destination asset");
  }
}
