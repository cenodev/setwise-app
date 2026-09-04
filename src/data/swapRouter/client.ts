import { z } from "zod";
import type { Hex } from "viem";

import { runtimeConfig } from "../../config/env";
import { SwapRouterApiError, swapRouterClientErrorCodes } from "./errors";
import {
  DEFAULT_SLIPPAGE_BPS,
  capabilitiesSchema,
  errorEnvelopeSchema,
  quoteListSchema,
  slippageBpsSchema,
  swapExecutionStatusResponseSchema,
  swapResponseSchema,
  type Capabilities,
  type QuoteDiagnostic,
  type SwapExecutionStatus,
  type SwapIntent,
  type SwapQuote,
  type SwapResponse,
} from "./schema";
import {
  assertPreparedSwapPreservesQuote,
  assertQuotePreservesIntent,
  assertStatusPreservesQuote,
} from "./validation";

/**
 * HTTP client for the provider-neutral swap-router contract. Every response
 * is schema-validated and then checked against the request identity before it
 * can reach UI state. All requests bypass HTTP caches (`no-store`); React
 * Query consumers should pair the query keys with `routedSwapQueryDefaults`
 * so quotes and statuses are always served from the network.
 */

/** React Query options that keep routed quotes and statuses network-only. */
export const routedSwapQueryDefaults = {
  gcTime: 0,
  refetchOnMount: "always",
  staleTime: 0,
} as const;

async function requestJson<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  init: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${runtimeConfig.swapRouterApiUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new SwapRouterApiError(
      swapRouterClientErrorCodes.networkError,
      error instanceof Error ? error.message : "Swap router is unavailable",
      0,
    );
  }

  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorEnvelopeSchema.safeParse(json);
    throw new SwapRouterApiError(
      parsed.success ? parsed.data.error.code : swapRouterClientErrorCodes.httpError,
      parsed.success ? parsed.data.error.message : `Swap router returned ${response.status}`,
      response.status,
      parsed.success ? (parsed.data.error.details ?? []) : [],
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new SwapRouterApiError(
      swapRouterClientErrorCodes.invalidResponse,
      "Swap router returned an unexpected response",
      response.status,
    );
  }
  return parsed.data;
}

/** GET /v1/capabilities — chains, providers, and feature flags for this deployment. */
export async function getSwapRouterCapabilities(signal?: AbortSignal): Promise<Capabilities> {
  return requestJson("/v1/capabilities", capabilitiesSchema, { method: "GET", signal });
}

export type SwapIntentInput = Omit<SwapIntent, "slippageBps"> & { slippageBps?: number };

function normalizeIntent(input: SwapIntentInput): SwapIntent {
  const slippageBps = input.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  if (!slippageBpsSchema.safeParse(slippageBps).success) {
    throw new Error(`slippageBps must be an integer between 0 and 5000, got ${input.slippageBps}`);
  }
  return { ...input, slippageBps };
}

/**
 * POST /v1/quotes — ranked normalized quotes for an exact-input intent.
 * Quotes that do not preserve the requested identity are rejected, so a
 * partial or confused provider response fails closed instead of surfacing a
 * quote for different money. Provider diagnostics ride along for display so
 * the UI can explain partial coverage (for example one provider down while
 * another quoted).
 */
export async function requestSwapQuotes(input: {
  intent: SwapIntentInput;
  signal?: AbortSignal;
}): Promise<SwapQuote[]> {
  const { quotes } = await requestSwapQuotesWithDiagnostics(input);
  return quotes;
}

/** Same as {@link requestSwapQuotes} but also returns per-provider diagnostics. */
export async function requestSwapQuotesWithDiagnostics(input: {
  intent: SwapIntentInput;
  signal?: AbortSignal;
}): Promise<{ quotes: SwapQuote[]; diagnostics: QuoteDiagnostic[] }> {
  const intent = normalizeIntent(input.intent);
  const { diagnostics, quotes } = await requestJson("/v1/quotes", quoteListSchema, {
    method: "POST",
    body: JSON.stringify({ intent }),
    signal: input.signal,
  });
  for (const quote of quotes) {
    assertQuotePreservesIntent(quote, intent);
  }
  return { diagnostics: diagnostics ?? [], quotes };
}

/**
 * POST /v1/swap — exchange the selected quote for its ERC-20 approval (when
 * needed) and prepared transaction. The response must echo the exact quote
 * the user selected.
 */
export async function prepareRoutedSwap(input: {
  quote: SwapQuote;
  signal?: AbortSignal;
}): Promise<SwapResponse> {
  const response = await requestJson("/v1/swap", swapResponseSchema, {
    method: "POST",
    body: JSON.stringify({ providerId: input.quote.providerId, quoteId: input.quote.quoteId }),
    signal: input.signal,
  });
  assertPreparedSwapPreservesQuote(response, input.quote);
  return response;
}

/**
 * POST /v1/swaps/status — provider-neutral execution status for a submitted
 * swap. The status endpoint is part of this app-side contract; app tests run
 * against normalized fixtures until the router ships it.
 */
export async function requestSwapExecutionStatus(input: {
  quote: SwapQuote;
  transactionHash?: Hex;
  signal?: AbortSignal;
}): Promise<SwapExecutionStatus> {
  const { status } = await requestJson("/v1/swaps/status", swapExecutionStatusResponseSchema, {
    method: "POST",
    body: JSON.stringify({
      providerId: input.quote.providerId,
      quoteId: input.quote.quoteId,
      ...(input.transactionHash !== undefined ? { transactionHash: input.transactionHash } : {}),
    }),
    signal: input.signal,
  });
  assertStatusPreservesQuote(status, input.quote);
  return status;
}
