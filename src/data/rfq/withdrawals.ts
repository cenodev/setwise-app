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
  poolId: z.string(),
  chainId: z.number().int(),
  poolAddress: addressSchema,
  tradingPaused: z.boolean(),
}).passthrough();

export const withdrawalQuoteSchema = z.object({
  indicativeQuoteId: z.string(),
  quoteType: z.literal("indicative"),
  operation: z.literal("withdrawal"),
  pricedAt: z.string().datetime(),
  validUntil: z.string().datetime(),
  stateSnapshot: stateSnapshotSchema,
  marketSnapshot: z.array(z.object({
    asset: z.string(),
    bidUsd: decimalSchema,
    askUsd: decimalSchema,
  }).passthrough()),
  input: amountSchema,
  outputs: z.array(amountSchema).min(1),
  mode: z.enum(["proportional", "single-asset"]),
  execution: z.enum(["direct-onchain", "requires-firm-quote"]),
  warnings: z.array(z.object({ code: z.string(), message: z.string() }).passthrough()),
}).passthrough();

export const firmWithdrawalQuoteSchema = z.object({
  firmQuoteId: z.string(),
  quoteType: z.literal("firm"),
  status: z.literal("executable"),
  operation: z.literal("withdrawal"),
  mode: z.literal("single-asset"),
  mustSubmitBy: z.string().datetime(),
  investor: addressSchema,
  shares: amountSchema,
  output: amountSchema,
  receiveNative: z.boolean(),
  transaction: z.object({
    chainId: z.number().int(),
    to: addressSchema,
    data: hexSchema,
    value: atomicSchema,
    method: z.literal("withdrawSingleAsset"),
  }),
  requirements: z.object({
    sender: addressSchema,
    minimumPoolTokenBalance: atomicSchema,
  }),
}).passthrough();

export type WithdrawalQuote = z.infer<typeof withdrawalQuoteSchema>;
export type FirmWithdrawalQuote = z.infer<typeof firmWithdrawalQuoteSchema>;
export type WithdrawalMode = "proportional" | "single-asset";

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

export function requestWithdrawalQuote(input: {
  outputAsset?: string;
  poolId: string;
  poolTokenAmount: string;
  signal?: AbortSignal;
}): Promise<WithdrawalQuote> {
  return requestJson("/v1/quotes/withdrawals", withdrawalQuoteSchema, {
    method: "POST",
    body: JSON.stringify({
      poolId: input.poolId,
      poolTokenAmount: input.poolTokenAmount,
      ...(input.outputAsset ? { outputAsset: input.outputAsset } : {}),
    }),
    signal: input.signal,
  });
}

export function requestFirmWithdrawalQuote(input: {
  idempotencyKey: string;
  investor: Address;
  outputAsset: string;
  poolId: string;
  poolTokenAmount: string;
  receiveNative: boolean;
}): Promise<FirmWithdrawalQuote> {
  return requestJson("/v1/firm-quotes/withdrawals", firmWithdrawalQuoteSchema, {
    method: "POST",
    headers: { "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({
      poolId: input.poolId,
      investor: input.investor,
      poolTokenAmount: input.poolTokenAmount,
      outputAsset: input.outputAsset,
      receiveNative: input.receiveNative,
    }),
  });
}
