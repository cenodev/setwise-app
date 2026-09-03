import {
  approvalSchema,
  capabilitiesSchema,
  errorEnvelopeSchema,
  preparedTransactionSchema,
  quoteListSchema,
  routeStepSchema,
  swapExecutionStatusSchema,
  swapIntentSchema,
  swapQuoteSchema,
  swapResponseSchema,
} from "./schema";
import {
  crossChainQuoteList,
  malformedQuoteListResponse,
  malformedStatusResponse,
  noRouteErrorEnvelope,
  sameChainPreparedSwap,
  sameChainQuote,
  sameChainQuoteList,
  swapRouterCapabilities,
} from "./fixtures";

const asset = { chainId: 56, address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" };
const otherAsset = { chainId: 56, address: "0x55d398326f99059fF775485246999027B3197955" };
const recipient = "0x4000000000000000000000000000000000000000";

const intent = {
  sourceAsset: asset,
  destinationAsset: otherAsset,
  amountIn: "25000000000000000000",
  recipient,
  slippageBps: 50,
};

describe("swap intent schema", () => {
  it("parses a canonical exact-input intent", () => {
    expect(swapIntentSchema.safeParse(intent).success).toBe(true);
  });

  it.each([
    ["a zero input amount", { ...intent, amountIn: "0" }],
    ["a negative input amount", { ...intent, amountIn: "-5" }],
    ["a decimal input amount", { ...intent, amountIn: "1.5" }],
    ["an overlong atomic string", { ...intent, amountIn: "1".repeat(37) }],
    ["a malformed source address", { ...intent, sourceAsset: { chainId: 56, address: "0x123" } }],
    ["a non-positive chain id", { ...intent, sourceAsset: { chainId: 0, address: asset.address } }],
    ["a fractional chain id", { ...intent, sourceAsset: { chainId: 56.5, address: asset.address } }],
    ["a malformed recipient", { ...intent, recipient: "not-an-address" }],
    ["negative slippage", { ...intent, slippageBps: -1 }],
    ["slippage above the contract bound", { ...intent, slippageBps: 5001 }],
    ["fractional slippage", { ...intent, slippageBps: 12.5 }],
  ])("rejects %s", (_name, value) => {
    expect(swapIntentSchema.safeParse(value).success).toBe(false);
  });
});

describe("route step schema", () => {
  it("requires a destination chain on bridge steps", () => {
    const bridge = { kind: "bridge", chainId: 1, fromAsset: asset, toAsset: otherAsset };
    expect(routeStepSchema.safeParse(bridge).success).toBe(false);
    expect(routeStepSchema.safeParse({ ...bridge, toChainId: 56 }).success).toBe(true);
  });

  it("accepts swap steps without a destination chain", () => {
    const step = { kind: "swap", chainId: 56, fromAsset: asset, toAsset: otherAsset };
    expect(routeStepSchema.safeParse(step).success).toBe(true);
  });
});

describe("normalized quote schema", () => {
  it("parses the same-chain and cross-chain fixtures", () => {
    expect(quoteListSchema.safeParse(sameChainQuoteList).success).toBe(true);
    expect(quoteListSchema.safeParse(crossChainQuoteList).success).toBe(true);
  });

  it("rejects the malformed fixture", () => {
    expect(quoteListSchema.safeParse(malformedQuoteListResponse).success).toBe(false);
  });

  it.each([
    ["an empty quote id", { quoteId: "" }],
    ["an empty provider id", { providerId: "" }],
    ["no route steps", { steps: [] }],
    ["an unknown fee kind", { fees: [{ kind: "mystery", asset, amount: "1" }] }],
    ["a non-integer duration", { estimatedDurationSeconds: 1.5 }],
    ["a malformed expiry", { expiresAt: "tomorrow" }],
    ["a decimal output", { amountOut: "1.5" }],
  ])("rejects a quote with %s", (_name, mutation) => {
    expect(swapQuoteSchema.safeParse({ ...sameChainQuote, ...mutation }).success).toBe(false);
  });

  it("strips unknown fields so provider payloads cannot leak into app state", () => {
    const parsed = swapQuoteSchema.parse({
      ...sameChainQuote,
      providerPayload: { raw: "0x-secret-provider-json" },
      intent: { ...sameChainQuote.intent, upstreamSession: "session-123" },
    });
    expect(parsed).not.toHaveProperty("providerPayload");
    expect(parsed.intent).not.toHaveProperty("upstreamSession");
  });
});

describe("approval and prepared transaction schemas", () => {
  const approval = {
    chainId: 56,
    owner: recipient,
    spender: "0x9000000000000000000000000000000000000009",
    token: asset.address,
    amount: "25000000000000000000",
  };
  const transaction = { chainId: 56, to: approval.spender, data: "0x1234", value: "0" };

  it("parses the prepared swap fixture", () => {
    expect(swapResponseSchema.safeParse(sameChainPreparedSwap).success).toBe(true);
  });

  it.each([
    ["a malformed owner", { ...approval, owner: "0x123" }],
    ["a malformed token", { ...approval, token: "0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" }],
    ["a decimal approval amount", { ...approval, amount: "1.5" }],
  ])("rejects an approval with %s", (_name, value) => {
    expect(approvalSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    ["odd-length calldata", { ...transaction, data: "0x123" }],
    ["non-hex calldata", { ...transaction, data: "0xzz" }],
    ["a malformed destination", { ...transaction, to: "0x123" }],
    ["a negative value", { ...transaction, value: "-1" }],
  ])("rejects a transaction with %s", (_name, value) => {
    expect(preparedTransactionSchema.safeParse(value).success).toBe(false);
  });
});

describe("capabilities schema", () => {
  it("parses the capabilities fixture", () => {
    expect(capabilitiesSchema.safeParse(swapRouterCapabilities).success).toBe(true);
  });

  it.each([
    ["a different service", { service: "other-service" }],
    ["a different api version", { apiVersion: "v2" }],
    ["exact-output support", { features: { ...swapRouterCapabilities.features, exactOutput: true } }],
    ["no exact-input support", { features: { ...swapRouterCapabilities.features, exactInput: false } }],
    ["an unknown provider status", { providers: [{ providerId: "fixture", enabled: true, status: "mystery", chains: [] }] }],
  ])("rejects %s", (_name, mutation) => {
    expect(capabilitiesSchema.safeParse({ ...swapRouterCapabilities, ...mutation }).success).toBe(false);
  });
});

describe("execution status schema", () => {
  const status = {
    providerId: "fixture",
    quoteId: "fxq.same-chain-v1",
    intent,
    state: "pending",
    transaction: { chainId: 56, hash: `0x${"ab".repeat(32)}` },
    detail: null,
    updatedAt: "2026-07-19T12:01:00.000Z",
  };

  it.each(["pending", "confirmed", "expired", "refunded", "failed"])("accepts the %s state", (state) => {
    expect(swapExecutionStatusSchema.safeParse({ ...status, state }).success).toBe(true);
  });

  it("rejects the malformed status fixture", () => {
    expect(swapExecutionStatusSchema.safeParse(malformedStatusResponse.status).success).toBe(false);
  });

  it.each([
    ["an unknown state", { state: "mystery" }],
    ["a short transaction hash", { transaction: { chainId: 56, hash: "0x1234" } }],
    ["a non-hex transaction hash", { transaction: { chainId: 56, hash: `0x${"zz".repeat(32)}` } }],
    ["a fractional transaction chain", { transaction: { chainId: 56.5, hash: `0x${"ab".repeat(32)}` } }],
    ["a malformed updatedAt", { updatedAt: "12:01" }],
  ])("rejects %s", (_name, mutation) => {
    expect(swapExecutionStatusSchema.safeParse({ ...status, ...mutation }).success).toBe(false);
  });
});

describe("error envelope schema", () => {
  it("parses the no-route envelope", () => {
    const parsed = errorEnvelopeSchema.safeParse(noRouteErrorEnvelope);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.error.code).toBe("UNSUPPORTED_ROUTE");
  });

  it("tolerates forward-compatible error codes for stable mapping", () => {
    const parsed = errorEnvelopeSchema.safeParse({ error: { code: "FUTURE_CODE", message: "new" } });
    expect(parsed.success).toBe(true);
  });

  it("rejects non-envelope error bodies", () => {
    expect(errorEnvelopeSchema.safeParse("<html>bad gateway</html>").success).toBe(false);
    expect(errorEnvelopeSchema.safeParse(null).success).toBe(false);
  });
});
