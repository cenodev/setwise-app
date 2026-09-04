import { isAddressEqual, type Address, type Hex } from "viem";

import {
  NATIVE_ASSET_ADDRESS,
  type SwapExecutionStatus,
  type SwapQuote,
  type SwapResponse,
} from "../../data/swapRouter/schema";
import type { RoutedSwapLifecycle } from "../activity/store";
import { quoteFresh } from "./routedModel";

/**
 * Pure, fail-closed policy for executing a reviewed routed swap. The user's
 * wallet is the only submitter: this module validates the prepared
 * transaction and approval against the reviewed quote right before the wallet
 * opens, and maps provider settlement states onto the local lifecycle. Any
 * mismatch throws instead of moving funds.
 */

export type RoutedExecutionStage =
  | "revalidating"
  | "switching"
  | "checking"
  | "approval-wallet"
  | "approval-confirming"
  | "simulating"
  | "wallet"
  | "confirming"
  | "tracking"
  | "delivered"
  | "partially-delivered"
  | "refunded"
  | "failed"
  | "unknown"
  | "rejected"
  | "approval-failed"
  | "expired"
  | "stale"
  | "error";

const busyRoutedStages: readonly RoutedExecutionStage[] = [
  "revalidating",
  "switching",
  "checking",
  "approval-wallet",
  "approval-confirming",
  "simulating",
  "wallet",
  "confirming",
  "tracking",
];

export function routedExecutionBusy(stage: RoutedExecutionStage): boolean {
  return busyRoutedStages.includes(stage);
}

export type RoutedConnectionSnapshot = {
  account: Address | undefined;
  chainId: number | undefined;
  online: boolean;
};

/**
 * Guards the window between review and wallet submission: connectivity,
 * account, and chain must be unchanged, and the reviewed quote must still be
 * fresh. Checked immediately before the wallet opens and again after any
 * await that could let state drift.
 */
export function assertRoutedExecutionWindow(input: {
  expectedAccount: Address;
  expectedChainId: number;
  quote: SwapQuote;
  now: number;
  snapshot: RoutedConnectionSnapshot;
}): void {
  const { expectedAccount, expectedChainId, quote, now, snapshot } = input;
  if (!snapshot.online) {
    throw new Error("Connectivity changed before wallet submission. Reconnect and review the route again.");
  }
  if (!snapshot.account || !isAddressEqual(snapshot.account, expectedAccount)) {
    throw new Error("Connected account changed before wallet submission. Review the route again.");
  }
  if (snapshot.chainId !== expectedChainId) {
    throw new Error("Wallet network changed before wallet submission. Switch to the source chain and review again.");
  }
  if (!quoteFresh(quote, now)) {
    throw new Error("The reviewed quote expired before wallet submission. Refresh the estimates.");
  }
}

/**
 * Revalidates the selected route immediately before execution. The re-quoted
 * list must still contain the reviewed quote with identical economics; the
 * returned fresh quote (which may carry a newer expiry) becomes the only
 * executable input. Anything else fails closed.
 */
export function revalidateReviewedQuote(input: {
  freshQuotes: readonly SwapQuote[];
  now: number;
  reviewed: SwapQuote;
}): SwapQuote {
  const stillOffered = input.freshQuotes.find((quote) => quote.quoteId === input.reviewed.quoteId);
  if (!stillOffered) {
    throw new Error("The reviewed route is no longer offered. Choose a route and review again.");
  }
  if (!quoteFresh(stillOffered, input.now)) {
    throw new Error("The reviewed quote expired before execution. Refresh the estimates.");
  }
  if (
    stillOffered.providerId !== input.reviewed.providerId
    || stillOffered.intent.sourceAsset.chainId !== input.reviewed.intent.sourceAsset.chainId
    || !isAddressEqual(stillOffered.intent.sourceAsset.address, input.reviewed.intent.sourceAsset.address)
    || stillOffered.intent.destinationAsset.chainId !== input.reviewed.intent.destinationAsset.chainId
    || !isAddressEqual(stillOffered.intent.destinationAsset.address, input.reviewed.intent.destinationAsset.address)
    || BigInt(stillOffered.intent.amountIn) !== BigInt(input.reviewed.intent.amountIn)
    || !isAddressEqual(stillOffered.intent.recipient, input.reviewed.intent.recipient)
    || BigInt(stillOffered.amountOut) !== BigInt(input.reviewed.amountOut)
    || BigInt(stillOffered.minAmountOut) !== BigInt(input.reviewed.minAmountOut)
  ) {
    throw new Error("The reviewed route changed while revalidating. Review the refreshed quotes again.");
  }
  return stillOffered;
}

export type RoutedApprovalPlan = {
  amount: bigint;
  owner: Address;
  spender: Address;
  token: Address;
};

export type RoutedSubmission = {
  account: Address;
  approval: RoutedApprovalPlan | null;
  chainId: number;
  data: Hex;
  to: Address;
  value: bigint;
};

/**
 * Turns a prepared swap into the only transaction the user's wallet may
 * submit. Enforces the exact-approval policy: the normalized approval target
 * must be the prepared transaction target itself (never approved by
 * assumption), scoped to the reviewed source token and sender, and for the
 * exact input amount — no buffer and no unlimited allowance.
 */
export function buildRoutedSubmission(input: { account: Address; prepared: SwapResponse }): RoutedSubmission {
  const { account, prepared } = input;
  const { approval, intent, transaction } = {
    approval: prepared.approval,
    intent: prepared.quote.intent,
    transaction: prepared.transaction,
  };
  const nativeInput = isAddressEqual(intent.sourceAsset.address, NATIVE_ASSET_ADDRESS);

  if (!isAddressEqual(account, intent.sender)) {
    throw new Error("The prepared swap requires a different sender than the connected wallet.");
  }
  if (transaction.chainId !== intent.sourceAsset.chainId) {
    throw new Error("The prepared transaction targets a different chain than the route source.");
  }
  const expectedValue = nativeInput ? BigInt(intent.amountIn) : 0n;
  if (BigInt(transaction.value) !== expectedValue) {
    throw new Error("The prepared transaction has an incorrect native value for the route input.");
  }

  if (nativeInput) {
    if (approval !== null) {
      throw new Error("Native-input routes must not require an ERC-20 approval.");
    }
    return {
      account,
      approval: null,
      chainId: transaction.chainId,
      data: transaction.data,
      to: transaction.to,
      value: BigInt(transaction.value),
    };
  }

  if (approval === null) {
    throw new Error("Token-input routes must include the ERC-20 approval.");
  }
  if (approval.chainId !== intent.sourceAsset.chainId
    || !isAddressEqual(approval.token, intent.sourceAsset.address)
    || !isAddressEqual(approval.owner, intent.sender)) {
    throw new Error("The normalized approval does not cover the reviewed source token and sender.");
  }
  if (!isAddressEqual(approval.spender, transaction.to)) {
    throw new Error("The approval spender does not match the prepared transaction target.");
  }
  const amount = BigInt(approval.amount);
  if (amount !== BigInt(intent.amountIn)) {
    throw new Error("The prepared approval is not the exact input amount; refusing to approve more than required.");
  }
  return {
    account,
    approval: { amount, owner: approval.owner, spender: approval.spender, token: approval.token },
    chainId: transaction.chainId,
    data: transaction.data,
    to: transaction.to,
    value: 0n,
  };
}

export type RoutedSettlement =
  | { detail: string | null; destinationHash?: Hex; kind: "pending"; lifecycle: "destination-pending" }
  | {
      detail: string | null;
      destinationHash?: Hex;
      kind: "terminal";
      lifecycle: "delivered" | "partially-delivered" | "refunded" | "failed" | "unknown";
    };

/**
 * Maps a provider-neutral execution status onto the local lifecycle. Only
 * `confirmed` is receipt of the destination token; `expired` after our own
 * source confirmation is contradictory, so it surfaces as an unknown state
 * with the provider detail instead of a silent success.
 */
export function mapExecutionStatus(status: SwapExecutionStatus): RoutedSettlement {
  const destinationHash = status.destinationTransaction?.hash;
  const detail = status.detail;
  switch (status.state) {
    case "confirmed":
      return { kind: "terminal", lifecycle: "delivered", destinationHash, detail };
    case "partially_delivered":
      return { kind: "terminal", lifecycle: "partially-delivered", destinationHash, detail };
    case "refunded":
      return { kind: "terminal", lifecycle: "refunded", destinationHash, detail };
    case "failed":
      return { kind: "terminal", lifecycle: "failed", destinationHash, detail };
    case "expired":
      return { kind: "terminal", lifecycle: "unknown", destinationHash, detail };
    case "pending":
      return { kind: "pending", lifecycle: "destination-pending", destinationHash, detail };
  }
}

export function isTerminalRoutedLifecycle(lifecycle: RoutedSwapLifecycle): boolean {
  return lifecycle === "delivered" || lifecycle === "partially-delivered"
    || lifecycle === "refunded" || lifecycle === "failed";
}

/** Execution stages that correspond to a tracked lifecycle; others are app-local. */
export function lifecycleForExecutionStage(stage: RoutedExecutionStage): RoutedSwapLifecycle | null {
  switch (stage) {
    case "confirming": return "source-submitted";
    case "tracking": return "destination-pending";
    case "delivered":
    case "partially-delivered":
    case "refunded":
    case "failed":
    case "unknown":
      return stage;
    default: return null;
  }
}

/** Human guidance shown beside each settled (or unsettled) routed outcome. */
export function routedRecoveryGuidance(lifecycle: RoutedSwapLifecycle): string {
  switch (lifecycle) {
    case "delivered":
      return "The route delivered the destination token to the recipient. Verify both transactions in the explorers.";
    case "partially-delivered":
      return "The route delivered only part of the expected output. The remainder is not expected; review the provider detail.";
    case "refunded":
      return "The route failed after submission and the input was refunded. Verify the refund on the source transaction before retrying.";
    case "failed":
      return "The route failed on chain and no destination tokens were delivered. Review the source transaction before retrying.";
    case "unknown":
      return "The provider could not confirm settlement. Verify the source transaction in the explorer; tracking continues automatically.";
    case "destination-pending":
      return "The source transaction confirmed. The route is settling the destination leg; no action is needed yet.";
    case "source-submitted":
      return "The transaction is submitted on the source chain and waiting for confirmation.";
    case "prepared":
      return "The wallet request was opened but the transaction was never submitted.";
    default:
      return "";
  }
}

/** Stable user-facing message for failures raised during routed execution. */
export function routedExecutionErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const normalized = error.message.toLowerCase();
    if (normalized.includes("user rejected") || normalized.includes("user denied")
      || normalized.includes("rejected the request")) {
      return "Rejected in wallet. Nothing was submitted; review the route and try again.";
    }
    return error.message;
  }
  return "Something went wrong while executing the routed swap. Review the route and try again.";
}

/** Distinguishes wallet rejections from other failures so stages stay honest. */
export function isWalletRejection(error: unknown): boolean {
  return error instanceof Error && (() => {
    const normalized = error.message.toLowerCase();
    return normalized.includes("user rejected") || normalized.includes("user denied")
      || normalized.includes("rejected the request");
  })();
}

/** Simulation failure mapping for the prepared transaction before wallet open. */
export function routedSimulationErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "The route could not be simulated. Review and retry.";
  const candidate = error as { details?: unknown; message?: unknown; shortMessage?: unknown };
  const detail = [candidate.shortMessage, candidate.details, candidate.message]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?? "Unknown error";
  const normalized = detail.toLowerCase();
  if (normalized.includes("insufficient funds") || normalized.includes("exceeds balance")
    || normalized.includes("not enough")) {
    return "The simulation reported insufficient funds for the swap or its gas. Review balances and retry.";
  }
  if (normalized.includes("allowance") || normalized.includes("allowence") || normalized.includes("spender")) {
    return "The simulation reported an insufficient allowance. Approve the exact amount and retry.";
  }
  if (normalized.includes("network") || normalized.includes("rpc") || normalized.includes("fetch")
    || normalized.includes("timeout") || normalized.includes("http request")) {
    return `The RPC could not simulate the route before wallet submission. Retry. ${detail}`;
  }
  return `Route simulation failed before wallet submission. ${detail}`;
}
