import { requestFirmWithdrawalQuote, requestWithdrawalQuote } from "./withdrawals";

const poolAddress = "0x1111111111111111111111111111111111111111";
const investor = "0x2222222222222222222222222222222222222222";
const at = "2026-07-15T12:00:00.000Z";
const until = "2026-07-15T12:00:10.000Z";

function response(json: unknown, status = 200) {
  return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
}

function indicative(mode: "proportional" | "single-asset") {
  return {
    indicativeQuoteId: "indicative-1",
    quoteType: "indicative",
    operation: "withdrawal",
    pricedAt: at,
    validUntil: until,
    stateSnapshot: { poolId: "pool", chainId: 97, poolAddress, tradingPaused: false },
    marketSnapshot: [{ asset: "WBNB", bidUsd: "600", askUsd: "601" }],
    input: { asset: "SETWISE", amount: "1.25", atomicAmount: "1250000000000000000", decimals: 18 },
    outputs: [{ asset: "WBNB", amount: "0.1", atomicAmount: "100000000000000000", decimals: 18 }],
    mode,
    execution: mode === "proportional" ? "direct-onchain" : "requires-firm-quote",
    warnings: [],
  };
}

describe("withdrawal RFQ client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("omits outputAsset for proportional previews and preserves the share decimal string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(indicative("proportional")));
    vi.stubGlobal("fetch", fetchMock);
    await requestWithdrawalQuote({ poolTokenAmount: "1.2500" });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(init.body)).toEqual(expect.objectContaining({ poolTokenAmount: "1.2500" }));
    expect(JSON.parse(init.body)).not.toHaveProperty("outputAsset");
  });

  it("sends output asset, investor, native preference, and idempotency for firm withdrawals", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(indicative("single-asset")))
      .mockResolvedValueOnce(response({
        firmQuoteId: "firm-1",
        quoteType: "firm",
        status: "executable",
        operation: "withdrawal",
        mode: "single-asset",
        mustSubmitBy: until,
        investor,
        shares: { asset: "SETWISE", amount: "1", atomicAmount: "1000000000000000000", decimals: 18 },
        output: { asset: "WBNB", amount: "0.1", atomicAmount: "100000000000000000", decimals: 18 },
        receiveNative: true,
        transaction: { chainId: 97, to: poolAddress, data: "0x1234", value: "0", method: "withdrawSingleAsset" },
        requirements: { sender: investor, minimumPoolTokenBalance: "1000000000000000000" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await requestWithdrawalQuote({ poolTokenAmount: "1", outputAsset: "WBNB" });
    await requestFirmWithdrawalQuote({
      idempotencyKey: "withdraw:test",
      investor,
      outputAsset: "WBNB",
      poolTokenAmount: "1",
      receiveNative: true,
    });

    const previewInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const firmInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    if (typeof previewInit.body !== "string" || typeof firmInit.body !== "string") {
      throw new Error("Expected JSON request bodies");
    }
    expect(JSON.parse(previewInit.body)).toMatchObject({ outputAsset: "WBNB" });
    expect(new Headers(firmInit.headers).get("Idempotency-Key")).toBe("withdraw:test");
    expect(JSON.parse(firmInit.body)).toMatchObject({ investor, outputAsset: "WBNB", receiveNative: true });
  });

  it("rejects malformed successful responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ quoteType: "indicative" })));
    await expect(requestWithdrawalQuote({ poolTokenAmount: "1" }))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
