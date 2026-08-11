import { fetchAssetMetricsCatalog } from "./assetMetrics";
import { tokenMetadataKey } from "./tokens";

const address = "0x1000000000000000000000000000000000000000";

function response() {
  return {
    apiVersion: "1.0",
    generatedAt: "2026-08-11T18:05:00.000Z",
    tokenListGeneratedAt: "2026-08-11T18:00:00.000Z",
    source: "dexscreener",
    coverage: { batchCount: 1, pairCount: 1, supportedTokenCount: 1, tokenCount: 1 },
    cache: { ageSeconds: 30, maxStaleSeconds: 900, status: "fresh" },
    tokens: [{ address, chainId: 56, chainName: "BNB Smart Chain", name: "Example RWA", symbol: "RWA" }],
    metrics: [{
      address,
      chainId: 56,
      liquidityUsd: 25_000,
      poolCount: 1,
      priceUsd: 42.5,
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
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/assets/metrics");
    expect(result.tokens).toHaveLength(1);
    expect(result.metrics.get(tokenMetadataKey(56, address))).toMatchObject({
      liquidityUsd: 25_000,
      topVenue: "pancakeswap",
      volume24hUsd: 5_000,
    });
  });

  it("rejects failed and malformed cache responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(fetchAssetMetricsCatalog()).rejects.toThrow("unavailable");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ apiVersion: "broken" })));
    await expect(fetchAssetMetricsCatalog()).rejects.toThrow("invalid snapshot");
  });
});
