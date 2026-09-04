import { z } from "zod";
import type { Address, Hex } from "viem";

/**
 * Provider-neutral swap-router contract, mirroring the versioned JSON schemas
 * published by cenodev/setwise-swap-router (`/v1/openapi.json`). The router
 * normalizes 0x, LI.FI, and later providers behind this contract; every object
 * below is provider-agnostic by construction.
 *
 * Toleration policy: zod objects strip unknown keys, so extra fields added by
 * the router (or accidentally leaked provider payloads) are dropped at this
 * boundary and can never reach UI state. Everything that identifies money —
 * chains, chain-qualified token addresses, sender/recipient, amounts,
 * transaction shape, and status shape — is strict and fails closed.
 */

const chainIdSchema = z.number().int().positive().safe();

const evmAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value as Address);

const hexDataSchema = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})*$/)
  .transform((value) => value as Hex);

const transactionHashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value as Hex);

/** Non-negative integer in atomic units, serialized as a decimal string. */
const uintStringSchema = z.string().regex(/^\d{1,36}$/);

const positiveAmountSchema = uintStringSchema.refine(
  // Format failures are already reported by the base schema; zod v3 still runs
  // this refinement, so only values that can convert reach the BigInt check.
  (value) => !/^\d{1,36}$/.test(value) || BigInt(value) > 0n,
  { message: "amount must be greater than zero" },
);

const isoDateTimeSchema = z.string().datetime();

/** The all-zero address denotes a chain's native gas asset in the router contract. */
export const NATIVE_ASSET_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

/** Chain-qualified token deployment identity. Symbols never authorize anything. */
export const assetReferenceSchema = z.object({
  chainId: chainIdSchema,
  address: evmAddressSchema,
});

export const DEFAULT_SLIPPAGE_BPS = 50;
export const MAX_SLIPPAGE_BPS = 5000;

export const slippageBpsSchema = z.number().int().min(0).max(MAX_SLIPPAGE_BPS);

/**
 * Exact-input swap intent. Exact-output intents are not supported by the
 * router contract.
 */
export const swapIntentSchema = z.object({
  sourceAsset: assetReferenceSchema,
  destinationAsset: assetReferenceSchema,
  amountIn: positiveAmountSchema,
  recipient: evmAddressSchema,
  slippageBps: slippageBpsSchema,
});

/**
 * Opaque, provider-neutral identifier of the upstream quote source. The app
 * round-trips it without interpretation, so providers added server-side later
 * are forward-compatible.
 */
export const providerIdSchema = z.string().min(1);

export const feeKindSchema = z.enum(["network", "protocol", "provider", "liquidity"]);

export const feeSchema = z.object({
  kind: feeKindSchema,
  asset: assetReferenceSchema,
  amount: uintStringSchema,
});

export const routeStepKindSchema = z.enum(["swap", "bridge"]);

export const routeStepSchema = z
  .object({
    kind: routeStepKindSchema,
    chainId: chainIdSchema,
    toChainId: chainIdSchema.optional(),
    fromAsset: assetReferenceSchema,
    toAsset: assetReferenceSchema,
  })
  .refine((step) => step.kind !== "bridge" || step.toChainId !== undefined, {
    message: "bridge steps must declare a destination chain",
  });

export const quoteIdSchema = z.string().min(1).max(4096);

/** Normalized, ranked quote. `quoteId` is an opaque token, never parsed. */
export const swapQuoteSchema = z.object({
  quoteId: quoteIdSchema,
  providerId: providerIdSchema,
  intent: swapIntentSchema,
  amountOut: uintStringSchema,
  minAmountOut: uintStringSchema,
  fees: z.array(feeSchema),
  steps: z.array(routeStepSchema).min(1),
  estimatedGas: uintStringSchema.optional(),
  estimatedDurationSeconds: z.number().int().nonnegative().optional(),
  expiresAt: isoDateTimeSchema,
});

export const quoteListSchema = z.object({
  quotes: z.array(swapQuoteSchema),
});

/** ERC-20 approval required before a token swap; null for native asset swaps. */
export const approvalSchema = z.object({
  chainId: chainIdSchema,
  owner: evmAddressSchema,
  spender: evmAddressSchema,
  token: evmAddressSchema,
  amount: uintStringSchema,
});

export const preparedTransactionSchema = z.object({
  chainId: chainIdSchema,
  to: evmAddressSchema,
  data: hexDataSchema,
  value: uintStringSchema,
  gas: uintStringSchema.optional(),
});

export const swapResponseSchema = z.object({
  approval: approvalSchema.nullable(),
  transaction: preparedTransactionSchema,
  quote: swapQuoteSchema,
});

export const chainCapabilitySchema = z.object({
  chainId: chainIdSchema,
  name: z.string().min(1),
  enabled: z.boolean(),
  nativeAsset: z.object({
    address: evmAddressSchema,
    symbol: z.string().min(1),
    decimals: z.number().int().nonnegative(),
  }),
});

export const providerStatusSchema = z.object({
  providerId: providerIdSchema,
  enabled: z.boolean(),
  status: z.enum(["ready", "degraded", "disabled"]),
  chains: z.array(chainIdSchema),
});

export const capabilitiesSchema = z.object({
  service: z.literal("setwise-swap-router"),
  apiVersion: z.literal("v1"),
  version: z.string().min(1),
  environment: z.enum(["local", "staging", "production"]),
  features: z.object({
    exactInput: z.literal(true),
    exactOutput: z.literal(false),
    crossChainSwaps: z.boolean(),
  }),
  chains: z.array(chainCapabilitySchema),
  providers: z.array(providerStatusSchema),
});

/**
 * Provider-neutral execution lifecycle for a submitted swap. Terminal states
 * are `confirmed`, `partially_delivered`, `expired`, `refunded`, and `failed`;
 * any other shape fails closed at this boundary. A partial delivery is its own
 * terminal state so the app never presents a partial fill as full receipt.
 */
export const swapExecutionStateSchema = z.enum([
  "pending",
  "confirmed",
  "partially_delivered",
  "expired",
  "refunded",
  "failed",
]);

export const swapExecutionTransactionSchema = z.object({
  chainId: chainIdSchema,
  hash: transactionHashSchema,
});

export const swapExecutionStatusSchema = z.object({
  providerId: providerIdSchema,
  quoteId: quoteIdSchema,
  intent: swapIntentSchema,
  state: swapExecutionStateSchema,
  transaction: swapExecutionTransactionSchema.nullable(),
  /**
   * Optional destination-leg settlement evidence reported by the route
   * provider once the bridged delivery has its own transaction. Absent while
   * the leg is in flight or when a provider cannot expose it.
   */
  destinationTransaction: swapExecutionTransactionSchema.nullable().optional(),
  detail: z.string().nullable(),
  updatedAt: isoDateTimeSchema,
});

export const swapExecutionStatusResponseSchema = z.object({
  status: swapExecutionStatusSchema,
});

/** Error codes published by the router's error envelope. */
export const swapRouterErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNSUPPORTED_CHAIN",
  "UNSUPPORTED_ROUTE",
  "UNSUPPORTED_PROVIDER",
  "NO_QUOTES",
  "INVALID_QUOTE",
  "QUOTE_EXPIRED",
  "PROVIDER_UNAVAILABLE",
  "POLICY_VIOLATION",
  "NOT_FOUND",
  "INTERNAL",
]);

/**
 * Lenient envelope parser for non-2xx responses: known codes pass through and
 * anything unrecognized maps to HTTP_ERROR, keeping the client mapping stable.
 */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string().optional(), message: z.string() })).optional(),
    requestId: z.string().optional(),
  }),
});

export type AssetReference = z.infer<typeof assetReferenceSchema>;
export type SwapIntent = z.infer<typeof swapIntentSchema>;
export type ProviderId = z.infer<typeof providerIdSchema>;
export type FeeKind = z.infer<typeof feeKindSchema>;
export type Fee = z.infer<typeof feeSchema>;
export type RouteStepKind = z.infer<typeof routeStepKindSchema>;
export type RouteStep = z.infer<typeof routeStepSchema>;
export type SwapQuote = z.infer<typeof swapQuoteSchema>;
export type QuoteList = z.infer<typeof quoteListSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type PreparedTransaction = z.infer<typeof preparedTransactionSchema>;
export type SwapResponse = z.infer<typeof swapResponseSchema>;
export type ChainCapability = z.infer<typeof chainCapabilitySchema>;
export type ProviderStatus = z.infer<typeof providerStatusSchema>;
export type Capabilities = z.infer<typeof capabilitiesSchema>;
export type SwapExecutionState = z.infer<typeof swapExecutionStateSchema>;
export type SwapExecutionTransaction = z.infer<typeof swapExecutionTransactionSchema>;
export type SwapExecutionStatus = z.infer<typeof swapExecutionStatusSchema>;
export type SwapRouterErrorCode = z.infer<typeof swapRouterErrorCodeSchema>;
