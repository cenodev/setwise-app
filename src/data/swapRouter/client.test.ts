import {
  getSwapRouterCapabilities,
  prepareRoutedSwap,
  requestSwapExecutionStatus,
  requestSwapQuotes,
  routedSwapQueryDefaults,
} from "./client";
import { SwapRouterApiError } from "./errors";
import { swapRouterQueryKeys } from "../queryKeys";
import {
  FIXTURE_TX_HASH,
  confirmedStatus,
  crossChainQuoteList,
  expiredQuoteErrorEnvelope,
  malformedQuoteListResponse,
  malformedStatusResponse,
  noRouteErrorEnvelope,
  partialProviderQuoteList,
  sameChainIntent,
  sameChainPreparedSwap,
  sameChainQuote,
  sameChainQuoteList,
  swapRouterCapabilities,
} from "./fixtures";

function response(json: unknown, status = 200) {
  return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
}

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(response(body, status));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lastInit(fetchMock: ReturnType<typeof stubFetch>): RequestInit {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
  return init;
}

const intentInput = {
  sourceAsset: sameChainIntent.sourceAsset,
  destinationAsset: sameChainIntent.destinationAsset,
  amountIn: sameChainIntent.amountIn,
  recipient: sameChainIntent.recipient,
};

describe("requestSwapQuotes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts an abortable exact-input intent with the default slippage and no-store caching", async () => {
    const fetchMock = stubFetch({ quotes: [sameChainQuote] });
    const controller = new AbortController();

    const quotes = await requestSwapQuotes({ intent: intentInput, signal: controller.signal });

    expect(quotes).toHaveLength(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8787/v1/quotes");
    const init = lastInit(fetchMock);
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBe(controller.signal);
    expect(JSON.parse(init.body as string)).toEqual({ intent: { ...intentInput, slippageBps: 50 } });
  });

  it("sends an explicit slippage tolerance", async () => {
    const fetchMock = stubFetch({ quotes: [sameChainQuote] });

    await requestSwapQuotes({ intent: { ...intentInput, slippageBps: 50 } });

    expect(JSON.parse(lastInit(fetchMock).body as string)).toEqual({ intent: sameChainIntent });
  });

  it("rejects out-of-range slippage before any network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestSwapQuotes({ intent: { ...intentInput, slippageBps: 5001 } })).rejects.toThrow(/slippageBps/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns same-chain and cross-chain fixture quotes", async () => {
    stubFetch(sameChainQuoteList);
    await expect(requestSwapQuotes({ intent: intentInput })).resolves.toHaveLength(1);
    vi.unstubAllGlobals();

    stubFetch(crossChainQuoteList);
    const crossChainInput = { ...intentInput, sourceAsset: crossChainQuoteList.quotes[0].intent.sourceAsset, destinationAsset: crossChainQuoteList.quotes[0].intent.destinationAsset, amountIn: crossChainQuoteList.quotes[0].intent.amountIn };
    await expect(requestSwapQuotes({ intent: { ...crossChainInput, slippageBps: 50 } })).resolves.toHaveLength(1);
  });

  it("accepts partial-provider quote lists", async () => {
    stubFetch(partialProviderQuoteList);
    const intent = { ...crossChainQuoteList.quotes[0].intent };
    await expect(requestSwapQuotes({ intent })).resolves.toHaveLength(1);
  });

  it("maps a no-route error envelope stably", async () => {
    stubFetch(noRouteErrorEnvelope, 422);

    const error = await requestSwapQuotes({ intent: intentInput }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SwapRouterApiError);
    expect(error).toMatchObject({ code: "UNSUPPORTED_ROUTE", status: 422 });
  });

  it("maps non-envelope error bodies to HTTP_ERROR", async () => {
    stubFetch("bad gateway", 502);

    await expect(requestSwapQuotes({ intent: intentInput }))
      .rejects.toMatchObject({ code: "HTTP_ERROR", status: 502 });
  });

  it("maps malformed success bodies to INVALID_RESPONSE", async () => {
    stubFetch(malformedQuoteListResponse);

    await expect(requestSwapQuotes({ intent: intentInput }))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 200 });
  });

  it("maps transport failures to NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(requestSwapQuotes({ intent: intentInput }))
      .rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
  });

  it("propagates abort errors without wrapping them", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("The operation was aborted.", "AbortError")));

    await expect(requestSwapQuotes({ intent: intentInput }))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("fails closed when a quote does not preserve the requested identity", async () => {
    stubFetch({
      quotes: [{
        ...sameChainQuote,
        intent: { ...sameChainQuote.intent, recipient: "0x5000000000000000000000000000000000000005" },
      }],
    });

    await expect(requestSwapQuotes({ intent: intentInput }))
      .rejects.toMatchObject({ code: "RESPONSE_MISMATCH" });
  });
});

describe("getSwapRouterCapabilities", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("gets capabilities with no-store caching", async () => {
    const fetchMock = stubFetch(swapRouterCapabilities);

    const capabilities = await getSwapRouterCapabilities();

    expect(capabilities.chains.map((chain) => chain.chainId)).toEqual([1, 56, 8453, 4663]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8787/v1/capabilities");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("GET");
    expect(init.cache).toBe("no-store");
  });
});

describe("prepareRoutedSwap", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exchanges the selected quote token for the approval and transaction", async () => {
    const fetchMock = stubFetch(sameChainPreparedSwap);

    const prepared = await prepareRoutedSwap({ quote: sameChainQuote });

    expect(prepared.transaction.chainId).toBe(56);
    expect(prepared.approval?.token).toBe(sameChainIntent.sourceAsset.address);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8787/v1/swap");
    expect(JSON.parse(lastInit(fetchMock).body as string)).toEqual({
      providerId: sameChainQuote.providerId,
      quoteId: sameChainQuote.quoteId,
    });
  });

  it("maps an expired quote envelope stably", async () => {
    stubFetch(expiredQuoteErrorEnvelope, 422);

    await expect(prepareRoutedSwap({ quote: sameChainQuote }))
      .rejects.toMatchObject({ code: "QUOTE_EXPIRED", status: 422 });
  });

  it("fails closed when the preparation echoes a different quote", async () => {
    stubFetch({ ...sameChainPreparedSwap, quote: { ...sameChainQuote, amountOut: "1" } });

    await expect(prepareRoutedSwap({ quote: sameChainQuote }))
      .rejects.toMatchObject({ code: "RESPONSE_MISMATCH" });
  });

  it("fails closed when the transaction targets another chain", async () => {
    stubFetch({ ...sameChainPreparedSwap, transaction: { ...sameChainPreparedSwap.transaction, chainId: 1 } });

    await expect(prepareRoutedSwap({ quote: sameChainQuote }))
      .rejects.toMatchObject({ code: "RESPONSE_MISMATCH" });
  });
});

describe("requestSwapExecutionStatus", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the tracked quote identity and optional transaction hash", async () => {
    const fetchMock = stubFetch({ status: confirmedStatus });

    const status = await requestSwapExecutionStatus({ quote: sameChainQuote, transactionHash: FIXTURE_TX_HASH });

    expect(status.state).toBe("confirmed");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8787/v1/swaps/status");
    expect(JSON.parse(lastInit(fetchMock).body as string)).toEqual({
      providerId: sameChainQuote.providerId,
      quoteId: sameChainQuote.quoteId,
      transactionHash: FIXTURE_TX_HASH,
    });
  });

  it("omits the transaction hash when not submitted yet", async () => {
    const fetchMock = stubFetch({ status: confirmedStatus });

    await requestSwapExecutionStatus({ quote: sameChainQuote });

    expect(JSON.parse(lastInit(fetchMock).body as string)).not.toHaveProperty("transactionHash");
  });

  it("fails closed on a malformed status shape", async () => {
    stubFetch(malformedStatusResponse);

    await expect(requestSwapExecutionStatus({ quote: sameChainQuote }))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("fails closed when the status reports on a different intent", async () => {
    stubFetch({ status: { ...confirmedStatus, intent: { ...confirmedStatus.intent, amountIn: "1" } } });

    await expect(requestSwapExecutionStatus({ quote: sameChainQuote }))
      .rejects.toMatchObject({ code: "RESPONSE_MISMATCH" });
  });
});

describe("query keys and cache defaults", () => {
  it("builds stable query keys for capabilities, quotes, and status", () => {
    expect(swapRouterQueryKeys.capabilities()).toEqual(["swap-router", "capabilities"]);
    expect(swapRouterQueryKeys.quotes(sameChainIntent)).toEqual(["swap-router", "quotes", sameChainIntent]);
    expect(swapRouterQueryKeys.status("fixture", "fxq.same-chain-v1"))
      .toEqual(["swap-router", "status", "fixture", "fxq.same-chain-v1"]);
  });

  it("keeps routed queries network-only", () => {
    expect(routedSwapQueryDefaults).toEqual({ gcTime: 0, refetchOnMount: "always", staleTime: 0 });
  });
});
