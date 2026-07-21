import { z } from "zod";
import type { Address, Hex } from "viem";

import { runtimeConfig } from "../../config/env";

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((value) => value as Address);
const hexSchema = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/).transform((value) => value as Hex);
const atomicSchema = z.string().regex(/^\d+$/);
const decimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);

const poolDisplaySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  sortOrder: z.number().int(),
  category: z.string().min(1).optional(),
}).passthrough();

const amountSchema = z.object({
  asset: z.string().min(1),
  amount: decimalSchema,
  atomicAmount: atomicSchema,
  decimals: z.number().int().min(0),
});

const balanceAmountSchema = z.object({
  amount: decimalSchema,
  atomicAmount: atomicSchema,
  decimals: z.number().int().min(0),
});

const externalLiquiditySourceSchema = z.object({
  chainId: z.number().int(),
  venue: z.string().min(1),
  sourceAddress: addressSchema,
  liquidityUsd: decimalSchema,
  observedAt: z.string().datetime().optional(),
}).passthrough();

const assetSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  name: z.string().optional(),
  address: addressSchema,
  decimals: z.number().int().min(0),
  weight: z.number().int().min(0),
  index: z.number().int().min(0),
  underlying: z.object({ symbol: z.string() }).passthrough().optional(),
  tokenStandard: z.string().optional(),
}).passthrough();

export const poolSchema = z.object({
  id: z.string().min(1),
  display: poolDisplaySchema,
  chain: z.object({ id: z.number().int(), name: z.string().nullable() }),
  contract: z.object({ address: addressSchema }).passthrough(),
  lpToken: z.object({ symbol: z.string(), decimals: z.number().int(), address: addressSchema }),
  quotePolicy: z.object({ allowedLockDays: z.array(z.number().int().min(0)) }).passthrough(),
  assets: z.array(assetSchema).min(1),
  pairs: z.array(z.object({
    assets: z.tuple([z.string().min(1), z.string().min(1)]),
    enabled: z.boolean(),
    feeBps: z.number().int().min(0),
  }).passthrough()).optional(),
  capabilities: z.object({
    nativeAsset: z.boolean(),
    swaps: z.object({ exactInput: z.boolean(), exactOutput: z.boolean(), firm: z.boolean(), indicative: z.boolean() }).passthrough(),
  }).passthrough().optional(),
}).passthrough();

export const poolStateSchema = z.object({
  poolId: z.string(),
  chainId: z.number().int(),
  poolAddress: addressSchema,
  blockNumber: atomicSchema,
  blockTimestamp: z.string().datetime(),
  trading: z.object({
    paused: z.boolean(),
    deposits: z.enum(["available", "paused"]),
    swaps: z.enum(["available", "paused"]).optional(),
  }).passthrough(),
  totalValueUsd: decimalSchema,
  totalSupply: balanceAmountSchema,
  externalLiquiditySources: z.array(externalLiquiditySourceSchema).optional(),
  contract: z.object({ wrappedNativeToken: addressSchema }).passthrough().optional(),
  assets: z.array(z.object({
    asset: z.string().min(1),
    amount: decimalSchema,
    atomicAmount: atomicSchema,
    decimals: z.number().int().min(0),
    index: z.number().int(),
    recordedAtomicBalance: atomicSchema,
    actualAtomicBalance: atomicSchema,
    balanceStatus: z.enum(["synced", "surplus", "deficit", "drifted"]),
    multiplier: decimalSchema,
    valueUsd: decimalSchema,
    market: z.object({
      bidUsd: decimalSchema,
      askUsd: decimalSchema,
      observedAt: z.string().datetime(),
    }).passthrough(),
  }).passthrough()),
}).passthrough();

export const depositQuoteSchema = z.object({
  indicativeQuoteId: z.string(),
  quoteType: z.literal("indicative"),
  operation: z.literal("deposit"),
  pricedAt: z.string().datetime(),
  validUntil: z.string().datetime(),
  lockDays: z.number().int(),
  stateSnapshot: z.object({
    chainId: z.number().int(),
    poolAddress: addressSchema,
    tradingPaused: z.boolean(),
  }).passthrough(),
  marketSnapshot: z.array(z.object({
    asset: z.string(),
    bidUsd: decimalSchema,
    askUsd: decimalSchema,
  }).passthrough()),
  deposits: z.array(amountSchema),
  orderedAtomicAmounts: z.array(atomicSchema),
  output: amountSchema,
  warnings: z.array(z.object({ code: z.string(), message: z.string() }).passthrough()),
}).passthrough();

const approvalRequirementSchema = z.object({
  token: addressSchema,
  spender: addressSchema,
  minimumAtomicAmount: atomicSchema,
});

export const firmDepositQuoteSchema = z.object({
  firmQuoteId: z.string(),
  quoteType: z.literal("firm"),
  status: z.literal("executable"),
  operation: z.literal("deposit"),
  mode: z.enum(["portfolio", "single-asset"]),
  mustSubmitBy: z.string().datetime(),
  investor: addressSchema,
  lockDays: z.number().int(),
  orderedAtomicAmounts: z.array(atomicSchema),
  shares: amountSchema,
  transaction: z.object({
    chainId: z.number().int(),
    to: addressSchema,
    data: hexSchema,
    value: atomicSchema,
    method: z.enum(["depositPortfolio", "depositSingleAsset"]),
  }),
  requirements: z.object({
    sender: addressSchema,
    approvals: z.array(approvalRequirementSchema),
  }),
}).passthrough();

export type Pool = z.infer<typeof poolSchema>;
export type PoolAsset = Pool["assets"][number];
export type PoolState = z.infer<typeof poolStateSchema>;
export type DepositQuote = z.infer<typeof depositQuoteSchema>;
export type FirmDepositQuote = z.infer<typeof firmDepositQuoteSchema>;

export type DepositAmount = { asset: string; amount: string };
export type DepositMode = "single-asset" | "portfolio";

export class RfqApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "RfqApiError";
  }
}

async function requestJson<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${runtimeConfig.rfqApiUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
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

export async function getPool(poolId: string, signal?: AbortSignal): Promise<Pool> {
  const response = await requestJson(`/v1/pools/${encodeURIComponent(poolId)}`,
    z.object({ pool: poolSchema }), { signal });
  return response.pool;
}

export function getPoolState(poolId: string, signal?: AbortSignal): Promise<PoolState> {
  return requestJson(`/v1/pools/${encodeURIComponent(poolId)}/state`, poolStateSchema, { signal });
}

export function requestDepositQuote(
  poolId: string,
  amounts: DepositAmount[],
  lockDays: number,
  signal?: AbortSignal,
): Promise<DepositQuote> {
  return requestJson("/v1/quotes/deposits", depositQuoteSchema, {
    method: "POST",
    body: JSON.stringify({ poolId, amounts, lockDays }),
    signal,
  });
}

export function requestFirmDepositQuote(input: {
  amounts: DepositAmount[];
  idempotencyKey: string;
  investor: Address;
  lockDays: number;
  mode: DepositMode;
  poolId: string;
}): Promise<FirmDepositQuote> {
  return requestJson("/v1/firm-quotes/deposits", firmDepositQuoteSchema, {
    method: "POST",
    headers: { "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({
      poolId: input.poolId,
      investor: input.investor,
      mode: input.mode,
      lockDays: input.lockDays,
      amounts: input.amounts,
    }),
  });
}
