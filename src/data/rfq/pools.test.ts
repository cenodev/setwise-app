import { getPools } from "./pools";

const poolAddress = "0x1111111111111111111111111111111111111111";
const lpAddress = "0x2222222222222222222222222222222222222222";
const tokenAddress = "0x3333333333333333333333333333333333333333";

function poolSummary(id: string, chainId = 97) {
  return {
    id,
    display: { name: `Set ${id}`, description: `Description for ${id}`, sortOrder: 0 },
    chain: { id: chainId, name: "BSC Testnet" },
    contract: { address: poolAddress },
    lpToken: { symbol: "SETWISE", decimals: 18, address: lpAddress },
    assets: [
      { id: "USDT", symbol: "mUSDT", address: tokenAddress, decimals: 6, weight: 5000, index: 0 },
    ],
    capabilities: {
      nativeAsset: true,
      swaps: { exactInput: true, exactOutput: true, firm: true, indicative: true },
      withdrawals: { firm: true, proportional: true, singleAsset: true },
    },
  };
}

function response(json: unknown, status = 200) {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("pool discovery client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches and validates the pool registry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      pools: [poolSummary("pool-a"), poolSummary("pool-b")],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const pools = await getPools();

    expect(pools).toHaveLength(2);
    expect(pools[0]?.id).toBe("pool-a");
    expect(pools[1]?.id).toBe("pool-b");
    expect(pools[0]?.capabilities?.withdrawals).toEqual({
      firm: true,
      proportional: true,
      singleAsset: true,
    });
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("/v1/pools");
  });

  it("returns an empty array when the registry has no pools", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ pools: [] })));
    await expect(getPools()).resolves.toEqual([]);
  });

  it("rejects a malformed registry response at the runtime boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ pools: [{ id: "" }] })));
    await expect(getPools()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a non-array pools field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ pools: "not-an-array" })));
    await expect(getPools()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("propagates structured API errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(
      { error: { code: "RATE_LIMITED", message: "Too many requests" } },
      429,
    )));
    await expect(getPools()).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
  });

  it("supports abort signals", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(response({ pools: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await getPools(controller.signal);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });
});
