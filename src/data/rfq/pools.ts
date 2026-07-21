import { z } from "zod";
import type { Address } from "viem";

import { runtimeConfig } from "../../config/env";
import { RfqApiError } from "./deposits";

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((value) => value as Address);

const poolDisplaySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  sortOrder: z.number().int(),
  category: z.string().min(1).optional(),
}).passthrough();

const poolAssetSummarySchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  name: z.string().optional(),
  address: addressSchema,
  decimals: z.number().int().min(0),
  weight: z.number().int().min(0),
  index: z.number().int().min(0),
}).passthrough();

export const poolSummarySchema = z.object({
  id: z.string().min(1),
  display: poolDisplaySchema,
  chain: z.object({ id: z.number().int(), name: z.string().nullable() }),
  contract: z.object({ address: addressSchema }).passthrough(),
  lpToken: z.object({ symbol: z.string(), decimals: z.number().int(), address: addressSchema }),
  assets: z.array(poolAssetSummarySchema).min(1),
  capabilities: z.object({
    nativeAsset: z.boolean(),
    swaps: z.object({ exactInput: z.boolean(), exactOutput: z.boolean(), firm: z.boolean(), indicative: z.boolean() }).passthrough(),
    withdrawals: z.object({
      proportional: z.boolean(),
      singleAsset: z.boolean(),
      firm: z.boolean(),
    }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();

const poolsResponseSchema = z.object({
  pools: z.array(poolSummarySchema),
});

export type PoolSummary = z.infer<typeof poolSummarySchema>;

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

export function getPools(signal?: AbortSignal): Promise<PoolSummary[]> {
  return requestJson("/v1/pools", poolsResponseSchema, { signal }).then((r) => r.pools);
}
