import {
  capabilitiesSchema,
  errorEnvelopeSchema,
  quoteListSchema,
  swapExecutionStatusSchema,
  swapResponseSchema,
} from "./schema";
import {
  assertPreparedSwapPreservesQuote,
  assertQuotePreservesIntent,
  assertStatusPreservesQuote,
} from "./validation";
import {
  confirmedStatus,
  crossChainIntent,
  crossChainQuote,
  crossChainQuoteList,
  expiredQuoteErrorEnvelope,
  expiredStatus,
  failedStatus,
  malformedQuoteListResponse,
  malformedStatusResponse,
  noRouteErrorEnvelope,
  partialProviderCapabilities,
  partialProviderQuoteList,
  pendingStatus,
  refundedStatus,
  sameChainIntent,
  sameChainPreparedSwap,
  sameChainQuote,
  sameChainQuoteList,
  swapRouterCapabilities,
} from "./fixtures";

/**
 * Fixture integrity: app tests exercise routed swaps entirely against these
 * normalized fixtures, so the fixtures must round-trip through JSON and stay
 * internally consistent with the identity validation the client enforces.
 */
describe("swap-router fixtures", () => {
  it("round-trips every valid fixture through JSON against its schema", () => {
    const cases: ReadonlyArray<readonly [string, { parse: (data: unknown) => unknown }, unknown]> = [
      ["sameChainQuoteList", quoteListSchema, sameChainQuoteList],
      ["crossChainQuoteList", quoteListSchema, crossChainQuoteList],
      ["partialProviderQuoteList", quoteListSchema, partialProviderQuoteList],
      ["sameChainPreparedSwap", swapResponseSchema, sameChainPreparedSwap],
      ["swapRouterCapabilities", capabilitiesSchema, swapRouterCapabilities],
      ["partialProviderCapabilities", capabilitiesSchema, partialProviderCapabilities],
      ["pendingStatus", swapExecutionStatusSchema, pendingStatus],
      ["confirmedStatus", swapExecutionStatusSchema, confirmedStatus],
      ["expiredStatus", swapExecutionStatusSchema, expiredStatus],
      ["refundedStatus", swapExecutionStatusSchema, refundedStatus],
      ["failedStatus", swapExecutionStatusSchema, failedStatus],
    ];
    for (const [name, schema, fixture] of cases) {
      const revived: unknown = JSON.parse(JSON.stringify(fixture));
      expect(schema.parse(revived), name).toEqual(fixture);
    }
  });

  it("keeps quotes consistent with their requested intents", () => {
    expect(() => assertQuotePreservesIntent(sameChainQuote, sameChainIntent)).not.toThrow();
    expect(() => assertQuotePreservesIntent(crossChainQuote, crossChainIntent)).not.toThrow();
  });

  it("keeps the prepared swap consistent with its quote", () => {
    expect(() => assertPreparedSwapPreservesQuote(sameChainPreparedSwap, sameChainQuote)).not.toThrow();
  });

  it("keeps every execution status consistent with its quote", () => {
    for (const status of [pendingStatus, confirmedStatus, expiredStatus, refundedStatus, failedStatus]) {
      expect(() => assertStatusPreservesQuote(status, sameChainQuote)).not.toThrow();
    }
  });

  it("models partial-provider coverage as a short quote list, not an error", () => {
    expect(partialProviderCapabilities.providers).toHaveLength(2);
    expect(partialProviderCapabilities.providers.some((provider) => provider.status === "degraded")).toBe(true);
    expect(partialProviderQuoteList.quotes).toHaveLength(1);
  });

  it("keeps malformed fixtures unparseable", () => {
    expect(quoteListSchema.safeParse(malformedQuoteListResponse).success).toBe(false);
    expect(swapExecutionStatusSchema.safeParse(malformedStatusResponse.status).success).toBe(false);
  });

  it("keeps error envelopes aligned with the stable client mapping", () => {
    expect(errorEnvelopeSchema.parse(noRouteErrorEnvelope).error.code).toBe("UNSUPPORTED_ROUTE");
    expect(errorEnvelopeSchema.parse(expiredQuoteErrorEnvelope).error.code).toBe("QUOTE_EXPIRED");
  });
});
