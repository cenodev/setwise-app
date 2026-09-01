import { z } from "zod";

import { runtimeConfig } from "../config/env";
import { tokenMetadataKey, tokenSchema, type TokenMetadata } from "./tokens";

const referencePriceSchema = z.object({
  askUsd: z.number().nonnegative().nullable(),
  asOf: z.string().datetime().nullable(),
  bidUsd: z.number().nonnegative().nullable(),
  priceUsd: z.number().nonnegative(),
  source: z.string().min(1),
  type: z.string().min(1),
  underlyingSymbol: z.string().min(1),
});

const deploymentMetricSchema = z.object({
  address: z.string().min(1),
  chainId: z.number().int(),
  liquidityUsd: z.number().nonnegative(),
  poolCount: z.number().int().nonnegative(),
  priceUsd: z.number().nonnegative().nullable(),
  referencePrice: referencePriceSchema.nullable().optional(),
  topVenue: z.string().min(1).nullable(),
  volume24hUsd: z.number().nonnegative(),
});

const assetMetricsSnapshotSchema = z.object({
  apiVersion: z.union([z.literal("1.0"), z.literal("1.1")]),
  generatedAt: z.string().datetime(),
  tokenListGeneratedAt: z.string().datetime().nullable(),
  source: z.literal("dexscreener"),
  coverage: z.object({
    batchCount: z.number().int().nonnegative(),
    pairCount: z.number().int().nonnegative(),
    referencePriceCount: z.number().int().nonnegative().optional(),
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

const assetMetricsRefreshSchema = z.object({
  asset: z.string().min(1),
  generatedAt: z.string().datetime(),
  metrics: z.array(deploymentMetricSchema),
  tokens: z.array(tokenSchema),
});

const assetMetricsErrorSchema = z.object({
  error: z.object({
    message: z.string().min(1),
  }),
});

export type DeploymentDexMetrics = {
  liquidityUsd: number;
  poolCount: number;
  priceUsd: number | null;
  referencePrice: z.infer<typeof referencePriceSchema> | null;
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

export type AssetMetricsRefresh = {
  asset: string;
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
        referencePrice: metric.referencePrice ?? null,
        topVenue: metric.topVenue,
        volume24hUsd: metric.volume24hUsd,
      },
    ])),
    tokens: parsed.data.tokens,
  };
}

export async function refreshAssetMetricsForAsset(
  asset: string,
  signal?: AbortSignal,
): Promise<AssetMetricsRefresh> {
  let response: Response;
  try {
    response = await fetch(
      `${runtimeConfig.assetMetricsApiUrl}/v1/assets/${encodeURIComponent(asset)}/metrics`,
      { method: "POST", signal },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AssetMetricsError("Fresh asset metrics are unavailable");
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsedError = assetMetricsErrorSchema.safeParse(body);
    throw new AssetMetricsError(
      parsedError.success ? parsedError.data.error.message : "Fresh asset metrics are unavailable",
    );
  }

  const parsed = assetMetricsRefreshSchema.safeParse(body);
  if (!parsed.success) throw new AssetMetricsError("Asset refresh returned invalid metrics");

  return {
    asset: parsed.data.asset,
    generatedAt: parsed.data.generatedAt,
    metrics: new Map(parsed.data.metrics.map((metric) => [
      tokenMetadataKey(metric.chainId, metric.address),
      {
        liquidityUsd: metric.liquidityUsd,
        poolCount: metric.poolCount,
        priceUsd: metric.priceUsd,
        referencePrice: metric.referencePrice ?? null,
        topVenue: metric.topVenue,
        volume24hUsd: metric.volume24hUsd,
      },
    ])),
    tokens: parsed.data.tokens,
  };
}

export function mergeAssetMetricsRefresh(
  catalog: AssetMetricsCatalog,
  refresh: AssetMetricsRefresh,
): AssetMetricsCatalog {
  const metrics = new Map(catalog.metrics);
  refresh.metrics.forEach((value, key) => metrics.set(key, value));

  const refreshedTokens = new Map(refresh.tokens.map((token) => [
    tokenMetadataKey(token.chainId, token.address),
    token,
  ]));
  const tokens = catalog.tokens.map((token) => (
    refreshedTokens.get(tokenMetadataKey(token.chainId, token.address)) ?? token
  ));
  const existingTokenKeys = new Set(tokens.map((token) => tokenMetadataKey(token.chainId, token.address)));
  refresh.tokens.forEach((token) => {
    if (!existingTokenKeys.has(tokenMetadataKey(token.chainId, token.address))) tokens.push(token);
  });

  const metricValues = [...metrics.values()];
  return {
    ...catalog,
    cache: { ...catalog.cache, ageSeconds: 0, status: "fresh" },
    coverage: {
      ...catalog.coverage,
      pairCount: metricValues.reduce((total, metric) => total + metric.poolCount, 0),
      referencePriceCount: metricValues.filter((metric) => metric.referencePrice !== null).length,
      tokenCount: tokens.length,
    },
    generatedAt: refresh.generatedAt,
    metrics,
    tokens,
  };
}
