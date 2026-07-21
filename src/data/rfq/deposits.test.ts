import { getPoolState, requestDepositQuote, requestFirmDepositQuote } from "./deposits";

const poolAddress = "0x1111111111111111111111111111111111111111";
const tokenAddress = "0x2222222222222222222222222222222222222222";
const investor = "0x3333333333333333333333333333333333333333";
const at = "2026-07-15T12:00:00.000Z";
const until = "2026-07-15T12:00:10.000Z";

function response(json: unknown, status = 200) {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("deposit RFQ client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves decimal strings in an indicative deposit request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      indicativeQuoteId: "indicative-1",
      quoteType: "indicative",
      operation: "deposit",
      pricedAt: at,
      validUntil: until,
      lockDays: 30,
      stateSnapshot: { chainId: 97, poolAddress, tradingPaused: false },
      marketSnapshot: [{ asset: "USDT", bidUsd: "1", askUsd: "1" }],
      deposits: [{ asset: "USDT", amount: "10.123", atomicAmount: "10123000", decimals: 6 }],
      orderedAtomicAmounts: ["10123000"],
      output: { asset: "SETWISE", amount: "9.9", atomicAmount: "9900000000000000000", decimals: 18 },
      warnings: [],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const quote = await requestDepositQuote("pool-a", [{ asset: "USDT", amount: "10.123" }], 30);

    expect(quote.output.atomicAmount).toBe("9900000000000000000");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(init.body)).toMatchObject({
      amounts: [{ asset: "USDT", amount: "10.123" }],
      lockDays: 30,
    });
  });

  it("sends the investor, mode, and idempotency key for firm deposits", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      firmQuoteId: "0x01",
      quoteType: "firm",
      status: "executable",
      operation: "deposit",
      mode: "single-asset",
      mustSubmitBy: until,
      investor,
      lockDays: 0,
      orderedAtomicAmounts: ["1000000"],
      shares: { asset: "SETWISE", amount: "1", atomicAmount: "1000000000000000000", decimals: 18 },
      transaction: { chainId: 97, to: poolAddress, data: "0x1234", value: "0", method: "depositSingleAsset" },
      requirements: {
        sender: investor,
        approvals: [{ token: tokenAddress, spender: poolAddress, minimumAtomicAmount: "1000000" }],
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await requestFirmDepositQuote({
      amounts: [{ asset: "USDT", amount: "1" }],
      idempotencyKey: "deposit:test",
      investor,
      lockDays: 0,
      mode: "single-asset",
      poolId: "pool-a",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("deposit:test");
    if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(init.body)).toMatchObject({ investor, mode: "single-asset" });
  });

  it("rejects malformed successful responses at the runtime boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ quoteType: "indicative" })));
    await expect(requestDepositQuote("pool-a", [{ asset: "USDT", amount: "1" }], 0))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("requires the analytics fields on a pool-state response", async () => {
    const validState = {
      poolId: "pool", chainId: 97, poolAddress, blockNumber: "1", blockTimestamp: at,
      trading: { paused: false, deposits: "available" }, totalValueUsd: "10",
      totalSupply: { amount: "10", atomicAmount: "10000000000000000000", decimals: 18 },
      assets: [{
        asset: "USDT", amount: "10", atomicAmount: "10000000", decimals: 6, index: 0,
        recordedAtomicBalance: "10000000", actualAtomicBalance: "10000000", balanceStatus: "synced",
        multiplier: "1", valueUsd: "10", market: { bidUsd: "1", askUsd: "1", observedAt: at },
      }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(validState)));
    await expect(getPoolState("pool")).resolves.toMatchObject({ blockNumber: "1", totalValueUsd: "10" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...validState, totalSupply: undefined })));
    await expect(getPoolState("pool")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
