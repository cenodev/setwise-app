import type { AssetReference, RouteStep, SwapQuote } from "../../data/swapRouter/schema";
import type { QuoteDiagnostic } from "../../data/swapRouter/schema";
import type { SwapIntentInput } from "../../data/swapRouter/client";
import { DEFAULT_SLIPPAGE_BPS } from "../../data/swapRouter/schema";
import { SwapRouterApiError } from "../../data/swapRouter/errors";
import type { RoutedMarketOption } from "../../data/marketCatalog";
import type { SourceAssetDeployment } from "../../config/sourceAssets";
import { atomicToDecimal, decimalInputError, decimalToAtomic } from "../../lib/decimal";
import { truncateAddress } from "../../lib/format";

/**
 * Pure domain logic for the chain-aware routed swap. The routed flow stops at
 * route review: intents are requested, quotes are compared, and a route is
 * reviewed — approval and submission remain a follow-up concern.
 */

export type RoutedSwapDraft = Readonly<{
  amountAtomic: bigint;
  destinationMarket: RoutedMarketOption;
  /** The connected wallet: holds the input funds and signs on the source chain. */
  sender: string;
  /** Where the destination asset is delivered; the app always delivers to the sender. */
  recipient: string;
  sourceAsset: SourceAssetDeployment;
}>;

/** Exact-input intent for the selected source deployment and destination market. */
export function buildRoutedSwapIntent(
  draft: RoutedSwapDraft,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS,
): SwapIntentInput {
  if (!/^0x[0-9a-fA-F]{40}$/.test(draft.sender)) {
    throw new Error("Routed swap requires a valid sender address");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(draft.recipient)) {
    throw new Error("Routed swap requires a valid recipient address");
  }
  return {
    amountIn: draft.amountAtomic.toString(),
    destinationAsset: {
      address: draft.destinationMarket.address,
      chainId: draft.destinationMarket.chainId,
    },
    sender: draft.sender as `0x${string}`,
    recipient: draft.recipient as `0x${string}`,
    slippageBps,
    sourceAsset: {
      address: draft.sourceAsset.address,
      chainId: draft.sourceAsset.chainId,
    },
  };
}

/**
 * Identity of a quote request. A response may only replace the draft when this
 * key equals the key built from the current draft; anything else is obsolete.
 */
export function routedQuoteRequestKey(draft: RoutedSwapDraft): string {
  return [
    draft.sourceAsset.chainId,
    draft.sourceAsset.address.toLowerCase(),
    draft.amountAtomic.toString(),
    draft.destinationMarket.chainId,
    draft.destinationMarket.address.toLowerCase(),
    draft.sender.toLowerCase(),
    draft.recipient.toLowerCase(),
  ].join(":");
}

export type RoutedAssetDescriptor = Readonly<{ decimals: number; symbol: string }>;

export type RoutedAssetResolver = (asset: AssetReference) => RoutedAssetDescriptor | undefined;

export function unresolvedRoutedAssetLabel(asset: AssetReference): string {
  return `${truncateAddress(asset.address)} on chain ${asset.chainId}`;
}

/** One human-readable line per quote fee, in the fee asset's own units. */
export function summarizeRoutedFees(
  fees: readonly { amount: string; asset: AssetReference; kind: string }[],
  resolveAsset: RoutedAssetResolver,
): readonly string[] {
  return fees.map((fee) => {
    const asset = resolveAsset(fee.asset);
    const amount = asset
      ? atomicToDecimal(BigInt(fee.amount), asset.decimals)
      : `${fee.amount} base units`;
    const symbol = asset?.symbol ?? unresolvedRoutedAssetLabel(fee.asset);
    return `${amount} ${symbol} ${fee.kind}`;
  });
}

export type RoutedChainResolver = (chainId: number) => string | undefined;

function stepAssetSymbol(asset: AssetReference, resolveAsset: RoutedAssetResolver): string {
  return resolveAsset(asset)?.symbol ?? truncateAddress(asset.address);
}

function stepChainName(chainId: number, resolveChain: RoutedChainResolver): string {
  return resolveChain(chainId) ?? `chain ${chainId}`;
}

/** Human-readable route steps: onchain swaps plus the underlying bridge leg. */
export function describeRouteSteps(
  steps: readonly RouteStep[],
  resolveAsset: RoutedAssetResolver,
  resolveChain: RoutedChainResolver,
): readonly string[] {
  return steps.map((step) => {
    const from = stepAssetSymbol(step.fromAsset, resolveAsset);
    const to = stepAssetSymbol(step.toAsset, resolveAsset);
    if (step.kind === "bridge") {
      const fromChain = stepChainName(step.chainId, resolveChain);
      const toChain = stepChainName(step.toChainId ?? step.chainId, resolveChain);
      return `Bridge ${from} on ${fromChain} to ${to} on ${toChain}`;
    }
    return `Swap ${from} for ${to} on ${stepChainName(step.chainId, resolveChain)}`;
  });
}

/** Guaranteed minimum received for the exact selected destination token. */
export function quoteGuaranteedOutput(quote: SwapQuote): bigint {
  return BigInt(quote.minAmountOut);
}

export function isSameChainQuote(quote: SwapQuote): boolean {
  return quote.intent.sourceAsset.chainId === quote.intent.destinationAsset.chainId;
}

export function quoteFresh(quote: SwapQuote, now: number): boolean {
  return Date.parse(quote.expiresAt) > now;
}

export function quoteSecondsRemaining(quote: SwapQuote, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - now) / 1_000));
}

export function formatRoutedOutput(atomic: string, decimals: number): string {
  return atomicToDecimal(BigInt(atomic), decimals);
}

/** Estimated origin gas for the route (gas units on the source chain). */
export function formatRoutedGasEstimate(estimatedGas: string | undefined): string {
  if (estimatedGas === undefined) return "—";
  return `${BigInt(estimatedGas).toLocaleString("en-US")} gas`;
}

export function formatRoutedDuration(seconds: number | undefined): string {
  if (seconds === undefined) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

export function routedAmountError(amount: string, sourceAsset: SourceAssetDeployment): string | null {
  const error = decimalInputError(amount, sourceAsset.decimals);
  if (error) return error;
  return decimalToAtomic(amount, sourceAsset.decimals) > 0n
    ? null
    : "Amount must be greater than zero";
}

const noRouteCodes = new Set(["UNSUPPORTED_ROUTE", "NO_QUOTES"]);

export function isNoRouteError(error: unknown): error is SwapRouterApiError {
  return error instanceof SwapRouterApiError && noRouteCodes.has(error.code);
}

export type ProviderFailureNote = Readonly<{
  providerId: string;
  /** Short human-readable reason derived from the router's diagnostic message. */
  reason: string;
}>;

function humanizeProviderMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("no_liquidity") || normalized.includes("no route") || normalized.includes("no route for")) {
    return "no route for this market right now";
  }
  if (normalized.includes("upstream_unavailable") || normalized.includes("upstream provider is unavailable")) {
    return "temporarily unavailable";
  }
  if (normalized.includes("unsupported")) {
    return "does not support this route";
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return "timed out on this request";
  }
  const withoutCode = message.replace(/^[A-Z][A-Z0-9_]*:\s*/, "").trim();
  return withoutCode.length > 0 ? withoutCode.slice(0, 140) : "did not return a quote";
}

/**
 * Display-only per-provider failure notes from a successful quote response's
 * diagnostics (for example one provider down while another quoted). Never
 * identifies money; safe to render verbatim.
 */
export function providerFailureNotes(
  diagnostics: readonly QuoteDiagnostic[],
): readonly ProviderFailureNote[] {
  const seen = new Set<string>();
  const notes: ProviderFailureNote[] = [];
  for (const diagnostic of diagnostics) {
    if (seen.has(diagnostic.providerId)) continue;
    seen.add(diagnostic.providerId);
    notes.push({ providerId: diagnostic.providerId, reason: humanizeProviderMessage(diagnostic.message) });
  }
  return notes;
}

/**
 * Display-only per-provider failure notes from a failed quote request's error
 * envelope details (paths look like `providers.<id>`). Returns an empty list
 * when the error carries no per-provider detail.
 */
export function quoteErrorProviderNotes(error: unknown): readonly ProviderFailureNote[] {
  if (!(error instanceof SwapRouterApiError)) return [];
  const seen = new Set<string>();
  const notes: ProviderFailureNote[] = [];
  for (const detail of error.details) {
    const match = detail.path !== undefined ? /^providers\.(.+)$/.exec(detail.path) : null;
    if (!match?.[1]) continue;
    const providerId = match[1];
    if (seen.has(providerId)) continue;
    seen.add(providerId);
    notes.push({ providerId, reason: humanizeProviderMessage(detail.message) });
  }
  return notes;
}

/**
 * Stable user-facing messages for routed quote failures. Router envelope codes
 * keep their meaning; transport and contract failures map to actionable copy.
 */
export function routedSwapErrorMessage(error: unknown): string {
  if (error instanceof SwapRouterApiError) {
    switch (error.code) {
      case "UNSUPPORTED_ROUTE":
      case "NO_QUOTES":
        return "No provider currently supports this route. Try another source chain, stablecoin, or destination market.";
      case "UNSUPPORTED_CHAIN":
        return "The swap router does not serve one of the selected chains for this route.";
      case "UNSUPPORTED_PROVIDER":
      case "PROVIDER_UNAVAILABLE":
        return "Route providers are temporarily unavailable. Retry shortly.";
      case "QUOTE_EXPIRED":
        return "The quote expired before it could be reviewed. Refresh the estimates.";
      case "INVALID_QUOTE":
      case "VALIDATION_ERROR":
        return "The router rejected this route request. Adjust the route and try again.";
      case "NETWORK_ERROR":
        return "The swap router is unreachable. Check your connection and retry.";
      default:
        return error.message;
    }
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong while requesting route quotes. Review the route and retry.";
}
