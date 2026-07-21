import { requestFirmSwapQuote, requestSwapQuote } from "./swaps";

const poolAddress = "0x1000000000000000000000000000000000000000";
const inputAddress = "0x2000000000000000000000000000000000000000";
const outputAddress = "0x3000000000000000000000000000000000000000";
const payer = "0x4000000000000000000000000000000000000000";
const quoteId = `0x${"1".repeat(64)}`;
const at = "2026-07-19T12:00:00.000Z";
const until = "2026-07-19T12:00:10.000Z";

const amount = (asset: string, value: string, atomicAmount: string) => ({
  amount: value, asset, atomicAmount, decimals: 18,
});

const venue = {
  blockNumber: "10",
  eligible: true,
  exclusionReason: null,
  gasEstimate: "100000",
  input: amount("USDT", "10", "10000000000000000000"),
  liquidityUsd: "100000",
  observedAt: at,
  output: amount("TOKEN", "2", "2000000000000000000"),
  priceImpactBps: 10,
  sourceId: "venue-1",
  venue: "test-venue",
};

const stateSnapshot = {
  blockHash: `0x${"2".repeat(64)}`,
  blockNumber: "10",
  blockTimestamp: at,
  chainId: 97,
  poolAddress,
  poolId: "bstock-ai-no-bnb-bsc-testnet",
  tradingPaused: false,
};

function indicative() {
  return {
    economics: {
      effectiveRate: "0.2",
      fairRate: "0.201",
      fee: { asset: "USDT", bps: 10, indicativeAtomicAmount: "10000000000000000", type: "curve-input-adjustment" },
      inputValueUsd: "10.00",
      outputValueUsd: "9.95",
      priceImpactBps: 5,
    },
    indicativeQuoteId: "indicative-1",
    input: venue.input,
    intent: "exact-input",
    marketSnapshot: [
      { asset: "USDT", askUsd: "1", bidUsd: "1", observedAt: at, provider: "fixed", providerSymbol: "USDT", quoteCurrency: "USD", secondarySession: "configured-reference", sequence: null, topAskQuantity: null, topBidQuantity: null, underlyingSession: null },
      { asset: "TOKEN", askUsd: "5", bidUsd: "4.99", observedAt: at, provider: "test", providerSymbol: "TOKENUSDT", quoteCurrency: "USDT", secondarySession: "24x7", sequence: "1", topAskQuantity: "10", topBidQuantity: "10", underlyingSession: "not-verified" },
    ],
    operation: "swap",
    output: venue.output,
    pricedAt: at,
    pricing: {
      constraints: { curveOutputAtomic: "2000000000000000000", externalGuardOutputAtomic: null, fairValueOutputAtomic: "2010000000000000000" },
      inventoryAfterLowerBound: "1.01",
      inventoryBefore: "1",
      k: "0.5",
      model: "setwise-inventory-v1.1",
      policy: { hedgeMarginBps: 10, maxInventoryPremiumBps: 0, maxMarketAgeMs: 5000, maxNotionalUsd: "10000", maxSpreadBps: 100, maxVenueDivergenceBps: 500, maxVenuePriceImpactBps: 300, minDexLiquidityUsd: "10000", minNotionalUsd: "10", requireExternalLiquidity: true, reserveBps: 100 },
      venues: [venue],
    },
    quoteType: "indicative",
    stateSnapshot,
    validUntil: until,
    warnings: [],
  };
}

function firm() {
  return {
    authorization: {
      digest: quoteId,
      signature: "0x1234",
      signer: inputAddress,
      typedData: {
        domain: { chainId: 97, name: "SetwisePool", verifyingContract: poolAddress, version: "2.0.0" },
        message: { deadline: "1", inputAmount: venue.input.atomicAmount, inputAsset: inputAddress, outputAmount: venue.output.atomicAmount, outputAsset: outputAddress, payer, quoteId, recipient: payer },
        primaryType: "SwapQuote",
        types: { SwapQuote: [{ name: "payer", type: "address" }] },
      },
    },
    createdAt: at,
    executionDeadline: "1784462410",
    firmQuoteId: quoteId,
    guard: { inputTolerancePpm: "5000", maximumInputBalance: "1", minimumOutputBalance: "1", offchainInputBalance: "1", offchainOutputBalance: "1", outputTolerancePpm: "5000", packedDeadline: "1" },
    input: venue.input,
    intent: "exact-input",
    mustSubmitBy: until,
    operation: "swap",
    output: venue.output,
    persisted: true,
    quoteType: "firm",
    requirements: { approvals: [{ minimumAtomicAmount: venue.input.atomicAmount, spender: poolAddress, token: inputAddress }], sender: payer },
    stateSnapshot: { ...stateSnapshot, blockTimestamp: "1784462400" },
    status: "executable",
    transaction: { chainId: 97, data: "0x1234", method: "swapExactAssetForAsset", to: poolAddress, value: "0" },
    venues: [venue],
    warnings: ["test warning"],
  };
}

function response(json: unknown) {
  return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
}

describe("swap RFQ client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts an abortable exact-input indicative request without cache access", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(indicative()));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const quote = await requestSwapQuote({ inputAmount: "10", inputAsset: "USDT", outputAsset: "TOKEN", poolId: "pool-a", signal: controller.signal });

    expect(quote.output.atomicAmount).toBe("2000000000000000000");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBe(controller.signal);
    if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(init.body)).toMatchObject({ inputAmount: "10", inputAsset: "USDT", outputAsset: "TOKEN" });
  });

  it("posts and validates an exact-output indicative request", async () => {
    const exactOutput = {
      ...indicative(),
      intent: "exact-output",
      pricing: {
        ...indicative().pricing,
        constraints: {
          curveInputAtomic: venue.input.atomicAmount,
          externalGuardInputAtomic: null,
          fairValueInputAtomic: venue.input.atomicAmount,
        },
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(response(exactOutput));
    vi.stubGlobal("fetch", fetchMock);

    const quote = await requestSwapQuote({ inputAsset: "USDT", outputAmount: "2", outputAsset: "TOKEN", poolId: "pool-a" });

    expect(quote.intent).toBe("exact-output");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(init.body)).toMatchObject({ inputAsset: "USDT", outputAmount: "2", outputAsset: "TOKEN" });
    expect(JSON.parse(init.body)).not.toHaveProperty("inputAmount");
  });

  it("sends native flags, both wallet roles, and a fresh idempotency header for firm quotes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(firm()));
    vi.stubGlobal("fetch", fetchMock);

    await requestFirmSwapQuote({ idempotencyKey: "swap:test", inputAmount: "10", inputAsset: "USDT", inputNative: false, outputAsset: "TOKEN", outputNative: false, payer, poolId: "pool-a", recipient: payer });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.cache).toBe("no-store");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("swap:test");
    if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(init.body)).toMatchObject({ inputNative: false, outputNative: false, payer, recipient: payer });
  });

  it("sends the fixed output amount for exact-output firm quotes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ ...firm(), intent: "exact-output" }));
    vi.stubGlobal("fetch", fetchMock);

    await requestFirmSwapQuote({ idempotencyKey: "swap:output", inputAsset: "USDT", inputNative: false, outputAmount: "2", outputAsset: "TOKEN", outputNative: false, payer, poolId: "pool-a", recipient: payer });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(init.body)).toMatchObject({ outputAmount: "2" });
    expect(JSON.parse(init.body)).not.toHaveProperty("inputAmount");
  });

  it("rejects incomplete indicative and firm responses at the runtime boundary", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ ...indicative(), pricing: undefined }))
      .mockResolvedValueOnce(response({ ...firm(), authorization: undefined }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestSwapQuote({ inputAmount: "10", inputAsset: "USDT", outputAsset: "TOKEN", poolId: "pool-a" }))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(requestFirmSwapQuote({ idempotencyKey: "swap:test", inputAmount: "10", inputAsset: "USDT", inputNative: false, outputAsset: "TOKEN", outputNative: false, payer, poolId: "pool-a", recipient: payer }))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
