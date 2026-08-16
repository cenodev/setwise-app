import { z } from "zod";

import { runtimeConfig } from "../config/env";
import { tokenMetadataKey, tokenSchema, type TokenMetadata } from "./tokens";

const deploymentMetricSchema = z.object({
  address: z.string().min(1),
  chainId: z.number().int(),
  liquidityUsd: z.number().nonnegative(),
  poolCount: z.number().int().nonnegative(),
  priceUsd: z.number().nonnegative().nullable(),
  topVenue: z.string().min(1).nullable(),
  volume24hUsd: z.number().nonnegative(),
});

const assetMetricsSnapshotSchema = z.object({
  apiVersion: z.literal("1.0"),
  generatedAt: z.string().datetime(),
  tokenListGeneratedAt: z.string().datetime().nullable(),
  source: z.literal("dexscreener"),
  coverage: z.object({
    batchCount: z.number().int().nonnegative(),
    pairCount: z.number().int().nonnegative(),
    supportedTokenCount: z.number().int().nonnegative(),
    tokenCount: z.number().int().nonnegative(),
  }),
  tokens: z.array(tokenSchema),
  metrics: z.array(deploymentMetricSchema),
  cache: z.object({
    ageSeconds: z.number().int().nonnegative(),
    maxStaleSeconds: z.number().int().nonnegative().nullable(),
    status: z.enum(["fresh", "stale"]),
  }),
});

export type DeploymentDexMetrics = {
  liquidityUsd: number;
  poolCount: number;
  priceUsd: number | null;
  topVenue: string | null;
  volume24hUsd: number;
};

export type DexMetricsIndex = ReadonlyMap<string, DeploymentDexMetrics>;

export type AssetMetricsCatalog = {
  cache: z.infer<typeof assetMetricsSnapshotSchema>["cache"];
  coverage: z.infer<typeof assetMetricsSnapshotSchema>["coverage"];
  generatedAt: string;
  metrics: DexMetricsIndex;
  tokens: TokenMetadata[];
};

export class AssetMetricsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetMetricsError";
  }
}

export async function fetchAssetMetricsCatalog(signal?: AbortSignal): Promise<AssetMetricsCatalog> {
  let response: Response;
  try {
    response = await fetch(`${runtimeConfig.assetMetricsApiUrl}/v1/assets/metrics`, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AssetMetricsError("Asset metrics are unavailable");
  }
  if (!response.ok) throw new AssetMetricsError("Asset metrics are unavailable");
  const parsed = assetMetricsSnapshotSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new AssetMetricsError("Asset metrics returned an invalid snapshot");
  return {
    cache: parsed.data.cache,
    coverage: parsed.data.coverage,
    generatedAt: parsed.data.generatedAt,
    metrics: new Map(parsed.data.metrics.map((metric) => [
      tokenMetadataKey(metric.chainId, metric.address),
      {
        liquidityUsd: metric.liquidityUsd,
        poolCount: metric.poolCount,
        priceUsd: metric.priceUsd,
        topVenue: metric.topVenue,
        volume24hUsd: metric.volume24hUsd,
      },
    ])),
    tokens: parsed.data.tokens,
  };
}
