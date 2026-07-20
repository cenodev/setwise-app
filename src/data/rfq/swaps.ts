import { z } from "zod";
import type { Address, Hex } from "viem";

import { runtimeConfig } from "../../config/env";
import { RfqApiError } from "./deposits";

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((value) => value as Address);
const hexSchema = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/).transform((value) => value as Hex);
const atomicSchema = z.string().regex(/^\d+$/);
const decimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);

const amountSchema = z.object({
  asset: z.string().min(1),
  amount: decimalSchema,
  atomicAmount: atomicSchema,
  decimals: z.number().int().min(0),
});

const stateSnapshotSchema = z.object({
  poolId: z.string().min(1),
  chainId: z.number().int(),
  poolAddress: addressSchema,
  blockNumber: atomicSchema,
  blockHash: hexSchema,
  blockTimestamp: z.union([z.string().datetime(), atomicSchema]),
  tradingPaused: z.boolean().optional(),
}).passthrough();

const venueSchema = z.object({
  sourceId: z.string().min(1),
  venue: z.string().min(1),
  input: amountSchema,
  output: amountSchema,
  eligible: z.boolean(),
  exclusionReason: z.string().nullable(),
  liquidityUsd: decimalSchema.nullable(),
  priceImpactBps: z.number().int().min(0).nullable(),
  gasEstimate: atomicSchema.nullable(),
  blockNumber: atomicSchema.nullable(),
  observedAt: z.string().datetime(),
});

const warningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  asset: z.string().optional(),
}).passthrough();

export const swapQuoteSchema = z.object({
  indicativeQuoteId: z.string().min(1),
  quoteType: z.literal("indicative"),
  operation: z.literal("swap"),
  intent: z.enum(["exact-input", "exact-output"]),
  pricedAt: z.string().datetime(),
  validUntil: z.string().datetime(),
  stateSnapshot: stateSnapshotSchema.extend({ tradingPaused: z.boolean() }),
  marketSnapshot: z.array(z.object({
    asset: z.string().min(1),
    bidUsd: decimalSchema,
    askUsd: decimalSchema,
    provider: z.string().min(1),
    providerSymbol: z.string().min(1),
    quoteCurrency: z.string().min(1),
    observedAt: z.string().datetime(),
    sequence: z.string().nullable(),
    topBidQuantity: decimalSchema.nullable(),
    topAskQuantity: decimalSchema.nullable(),
    secondarySession: z.string().min(1),
    underlyingSession: z.string().nullable(),
  }).passthrough()).min(1),
  input: amountSchema,
  output: amountSchema,
  economics: z.object({
    inputValueUsd: decimalSchema,
    outputValueUsd: decimalSchema,
    effectiveRate: decimalSchema,
    fairRate: decimalSchema,
    priceImpactBps: z.number().int().min(0),
    fee: z.object({
      type: z.literal("curve-input-adjustment"),
      bps: z.number().int().min(0),
      asset: z.string().min(1),
      indicativeAtomicAmount: atomicSchema,
    }),
  }),
  pricing: z.object({
    model: z.string().min(1),
    k: decimalSchema,
    policy: z.object({
      minNotionalUsd: decimalSchema,
      maxNotionalUsd: decimalSchema,
      maxMarketAgeMs: z.number().int().min(0),
      maxSpreadBps: z.number().int().min(0),
      maxVenueDivergenceBps: z.number().int().min(0),
      maxVenuePriceImpactBps: z.number().int().min(0),
      minDexLiquidityUsd: decimalSchema,
      reserveBps: z.number().int().min(0),
      hedgeMarginBps: z.number().int().min(0),
      maxInventoryPremiumBps: z.number().int().min(0),
      requireExternalLiquidity: z.boolean(),
    }),
    inventoryBefore: decimalSchema,
    inventoryAfterLowerBound: decimalSchema,
    constraints: z.union([
      z.object({
        curveOutputAtomic: atomicSchema,
        fairValueOutputAtomic: atomicSchema,
        externalGuardOutputAtomic: atomicSchema.nullable(),
      }),
      z.object({
        curveInputAtomic: atomicSchema,
        fairValueInputAtomic: atomicSchema,
        externalGuardInputAtomic: atomicSchema.nullable(),
      }),
    ]),
    venues: z.array(venueSchema),
  }),
  warnings: z.array(warningSchema),
});

const typedDataSchema = z.object({
  domain: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    chainId: z.number().int(),
    verifyingContract: addressSchema,
  }),
  primaryType: z.literal("SwapQuote"),
  types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
  message: z.object({
    payer: addressSchema,
    inputAsset: addressSchema,
    outputAsset: addressSchema,
    inputAmount: atomicSchema,
    outputAmount: atomicSchema,
    quoteId: hexSchema,
    deadline: atomicSchema,
    recipient: addressSchema,
  }).passthrough(),
});

const approvalRequirementSchema = z.object({
  token: addressSchema,
  spender: addressSchema,
  minimumAtomicAmount: atomicSchema,
});

export const firmSwapQuoteSchema = z.object({
  firmQuoteId: hexSchema,
  quoteType: z.literal("firm"),
  status: z.literal("executable"),
  operation: z.literal("swap"),
  intent: z.enum(["exact-input", "exact-output"]),
  createdAt: z.string().datetime(),
  mustSubmitBy: z.string().datetime(),
  executionDeadline: atomicSchema,
  stateSnapshot: stateSnapshotSchema,
  input: amountSchema,
  output: amountSchema,
  venues: z.array(venueSchema),
  guard: z.object({
    packedDeadline: atomicSchema,
    offchainInputBalance: atomicSchema,
    offchainOutputBalance: atomicSchema,
    inputTolerancePpm: atomicSchema,
    outputTolerancePpm: atomicSchema,
    maximumInputBalance: atomicSchema,
    minimumOutputBalance: atomicSchema,
  }),
  authorization: z.object({
    signer: addressSchema,
    digest: hexSchema,
    signature: hexSchema,
    typedData: typedDataSchema,
  }),
  transaction: z.object({
    chainId: z.number().int(),
    to: addressSchema,
    data: hexSchema,
    value: atomicSchema,
    method: z.enum(["swapExactAssetForAsset", "swapExactNativeForAsset", "swapExactAssetForNative"]),
  }),
  requirements: z.object({
    sender: addressSchema,
    approvals: z.array(approvalRequirementSchema),
  }),
  warnings: z.array(z.string()),
  persisted: z.boolean(),
  idempotentReplay: z.boolean().optional(),
});

export type SwapQuote = z.infer<typeof swapQuoteSchema>;
export type FirmSwapQuote = z.infer<typeof firmSwapQuoteSchema>;

async function requestJson<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  init: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${runtimeConfig.rfqApiUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new RfqApiError("NETWORK_ERROR", error instanceof Error ? error.message : "RFQ API is unavailable", 0);
  }

  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = z.object({ error: z.object({ code: z.string(), message: z.string() }) }).safeParse(json);
    throw new RfqApiError(
      parsed.success ? parsed.data.error.code : "HTTP_ERROR",
      parsed.success ? parsed.data.error.message : `RFQ API returned ${response.status}`,
      response.status,
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new RfqApiError("INVALID_RESPONSE", "RFQ API returned an unexpected response", response.status);
  }
  return parsed.data;
}

type SwapAmount =
  | { inputAmount: string; outputAmount?: never }
  | { inputAmount?: never; outputAmount: string };

export function requestSwapQuote(input: {
  inputAsset: string;
  outputAsset: string;
  signal?: AbortSignal;
} & SwapAmount): Promise<SwapQuote> {
  return requestJson("/v1/quotes/swaps", swapQuoteSchema, {
    method: "POST",
    body: JSON.stringify({
      poolId: runtimeConfig.poolId,
      inputAsset: input.inputAsset,
      outputAsset: input.outputAsset,
      ...(input.inputAmount !== undefined
        ? { inputAmount: input.inputAmount }
        : { outputAmount: input.outputAmount }),
    }),
    signal: input.signal,
  });
}

export function requestFirmSwapQuote(input: {
  idempotencyKey: string;
  inputAsset: string;
  inputNative: boolean;
  outputAsset: string;
  outputNative: boolean;
  payer: Address;
  recipient: Address;
} & SwapAmount): Promise<FirmSwapQuote> {
  return requestJson("/v1/firm-quotes/swaps", firmSwapQuoteSchema, {
    method: "POST",
    headers: { "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({
      poolId: runtimeConfig.poolId,
      inputAsset: input.inputAsset,
      outputAsset: input.outputAsset,
      ...(input.inputAmount !== undefined
        ? { inputAmount: input.inputAmount }
        : { outputAmount: input.outputAmount }),
      payer: input.payer,
      recipient: input.recipient,
      inputNative: input.inputNative,
      outputNative: input.outputNative,
    }),
  });
}

export function createSwapIdempotencyKey(): string {
  return `swap:${crypto.randomUUID()}`;
}
