import {
  fetchAssetMetricsCatalog,
  mergeAssetMetricsRefresh,
  refreshAssetMetricsForAsset,
} from "./assetMetrics";
import { tokenMetadataKey } from "./tokens";

const address = "0x1000000000000000000000000000000000000000";

function response() {
  return {
    apiVersion: "1.1",
    generatedAt: "2026-08-11T18:05:00.000Z",
    tokenListGeneratedAt: "2026-08-11T18:00:00.000Z",
    source: "dexscreener",
    coverage: {
      batchCount: 1,
      pairCount: 1,
      referencePriceCount: 1,
      supportedTokenCount: 1,
      tokenCount: 1,
    },
    cache: { ageSeconds: 30, maxStaleSeconds: 900, status: "fresh" },
    tokens: [{ address, chainId: 56, chainName: "BNB Smart Chain", name: "Example RWA", symbol: "RWA" }],
    metrics: [{
      address,
      chainId: 56,
      liquidityUsd: 25_000,
      poolCount: 1,
      priceUsd: 42.5,
      referencePrice: {
        askUsd: null,
        asOf: null,
        bidUsd: null,
        priceUsd: 42.5,
        source: "xstocks",
        type: "issuer-indicative",
        underlyingSymbol: "RWA",
      },
      topVenue: "pancakeswap",
      volume24hUsd: 5_000,
    }],
  };
}

describe("cached asset metrics", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads one Setwise snapshot and indexes deployment metrics", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(response()));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchAssetMetricsCatalog();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://setwise-asset-metrics.datadex.workers.dev/v1/assets/metrics",
    );
    expect(result.tokens).toHaveLength(1);
    const metric = result.metrics.get(tokenMetadataKey(56, address));
    expect(metric).toMatchObject({
      liquidityUsd: 25_000,
      topVenue: "pancakeswap",
      volume24hUsd: 5_000,
    });
    expect(metric?.referencePrice).toMatchObject({
      asOf: null,
      priceUsd: 42.5,
      underlyingSymbol: "RWA",
    });
  });

  it("rejects failed and malformed cache responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(fetchAssetMetricsCatalog()).rejects.toThrow("unavailable");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ apiVersion: "broken" })));
    await expect(fetchAssetMetricsCatalog()).rejects.toThrow("invalid snapshot");
  });

  it("refreshes one underlying asset and indexes the returned deployments", async () => {
    const refreshed = {
      asset: "RWA",
      generatedAt: "2026-08-11T18:06:00.000Z",
      metrics: response().metrics,
      tokens: response().tokens,
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(refreshed));
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshAssetMetricsForAsset("rwa");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://setwise-asset-metrics.datadex.workers.dev/v1/assets/rwa/metrics",
      { method: "POST", signal: undefined },
    );
    expect(result.generatedAt).toBe("2026-08-11T18:06:00.000Z");
    expect(result.metrics.get(tokenMetadataKey(56, address))?.referencePrice?.source).toBe("xstocks");
  });

  it("preserves the API error message when an asset refresh fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      error: { code: "ASSET_METRICS_WARMING", message: "Asset metrics cache has not been populated yet" },
    }, { status: 503 })));

    await expect(refreshAssetMetricsForAsset("RWA")).rejects.toThrow(
      "Asset metrics cache has not been populated yet",
    );
  });

  it("merges refreshed metrics without dropping unrelated assets", () => {
    const catalog = {
      cache: { ageSeconds: 30, maxStaleSeconds: 900, status: "fresh" as const },
      coverage: {
        batchCount: 2,
        pairCount: 2,
        referencePriceCount: 0,
        supportedTokenCount: 2,
        tokenCount: 2,
      },
      generatedAt: "2026-08-11T18:05:00.000Z",
      metrics: new Map([
        [tokenMetadataKey(56, address), {
          liquidityUsd: 10,
          poolCount: 1,
          priceUsd: 40,
          referencePrice: null,
          topVenue: "old-dex",
          volume24hUsd: 5,
        }],
        ["1:unrelated", {
          liquidityUsd: 20,
          poolCount: 2,
          priceUsd: 20,
          referencePrice: null,
          topVenue: "other-dex",
          volume24hUsd: 10,
        }],
      ]),
      tokens: response().tokens,
    };
    const refresh = {
      asset: "RWA",
      generatedAt: "2026-08-11T18:06:00.000Z",
      metrics: new Map([[tokenMetadataKey(56, address), {
        liquidityUsd: 25_000,
        poolCount: 1,
        priceUsd: 42.5,
        referencePrice: null,
        topVenue: "pancakeswap",
        volume24hUsd: 5_000,
      }]]),
      tokens: response().tokens,
    };

    const merged = mergeAssetMetricsRefresh(catalog, refresh);

    expect(merged.generatedAt).toBe(catalog.generatedAt);
    expect(merged.cache).toEqual(catalog.cache);
    expect(merged.metrics.get("1:unrelated")?.topVenue).toBe("other-dex");
    expect(merged.metrics.get(tokenMetadataKey(56, address))?.topVenue).toBe("pancakeswap");
    expect(merged.coverage.pairCount).toBe(3);
  });
});
