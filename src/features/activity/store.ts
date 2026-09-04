import type { Hash } from "viem";

import { swapQuoteSchema, type SwapQuote } from "../../data/swapRouter/schema";

const STORAGE_KEY = "setwise.local-activity.v1";
const ACTIVITY_EVENT = "setwise:activity-updated";

/**
 * Top-level outcome of an activity record. Routed swaps extend it with the
 * settlement outcomes they can reach: a partial delivery is not a receipt of
 * the requested token, and a refund means the input came back.
 */
export type ActivityStatus = "pending" | "success" | "failed" | "partial" | "refunded";
export type ActivityAmount = { amount: string; symbol: string };

/**
 * Provider-neutral lifecycle of a routed swap. `delivered` is the only state
 * that represents receipt of the requested destination token; everything else
 * must be presented as in-flight, partial, refunded, failed, or unknown.
 */
export type RoutedSwapLifecycle =
  | "prepared"
  | "source-submitted"
  | "destination-pending"
  | "delivered"
  | "partially-delivered"
  | "refunded"
  | "failed"
  | "unknown";

export const routedSwapLifecycles: readonly RoutedSwapLifecycle[] = [
  "prepared",
  "source-submitted",
  "destination-pending",
  "delivered",
  "partially-delivered",
  "refunded",
  "failed",
  "unknown",
];

/** Lifecycles that may still settle and therefore benefit from status polling. */
export const resumableRoutedLifecycles: readonly RoutedSwapLifecycle[] = [
  "source-submitted",
  "destination-pending",
  "unknown",
];

export function isResumableRoutedLifecycle(lifecycle: RoutedSwapLifecycle): boolean {
  return resumableRoutedLifecycles.includes(lifecycle);
}

export function routedLifecycleStatus(lifecycle: RoutedSwapLifecycle): ActivityStatus {
  switch (lifecycle) {
    case "delivered": return "success";
    case "partially-delivered": return "partial";
    case "refunded": return "refunded";
    case "failed": return "failed";
    default: return "pending";
  }
}

/**
 * Routed execution evidence persisted beside the swap record. `quote` is kept
 * verbatim so status polling can resume after a reload and still validate the
 * provider response against the exact reviewed economics.
 */
export type RoutedSwapTracking = {
  approvalHash?: Hash;
  destinationChainId: number;
  destinationHash?: Hash;
  lifecycle: RoutedSwapLifecycle;
  providerDetail?: string;
  quote: SwapQuote;
  quoteId: string;
  routeProvider: string;
  sourceChainId: number;
};

type ActivityBase = {
  chainId: number;
  error?: string;
  hash?: Hash;
  id: string;
  status: ActivityStatus;
  submitted?: boolean;
  timestamp: number;
};

export type SwapActivityRecord = ActivityBase & {
  input: ActivityAmount;
  operation: "swap";
  output: ActivityAmount;
  /** Optional only so records written before multi-Set support remain readable. */
  setId?: string;
  /** Optional only so records written before routed swaps remain readable. */
  routed?: RoutedSwapTracking;
};

export type DepositActivityRecord = ActivityBase & {
  deposits: ActivityAmount[];
  lockDays: number;
  mode: "portfolio" | "single-asset";
  operation: "deposit";
  setId: string;
  shares: ActivityAmount;
};

export type WithdrawalActivityRecord = ActivityBase & {
  mode: "proportional" | "single-asset";
  operation: "withdrawal";
  outputs: ActivityAmount[];
  /** Optional only so records written before multi-Set support remain readable. */
  setId?: string;
  shares: ActivityAmount;
};

export type ActivityRecord = SwapActivityRecord | DepositActivityRecord | WithdrawalActivityRecord;
type ActivityUpdate = Partial<Pick<ActivityBase, "error" | "hash" | "status" | "submitted">>;
type RoutedUpdate = Partial<Pick<RoutedSwapTracking, "destinationHash" | "providerDetail">> & {
  error?: string;
  sourceHash?: Hash;
};

const hashPattern = /^0x[0-9a-fA-F]{64}$/;

function isActivityHash(value: unknown): value is Hash {
  return typeof value === "string" && hashPattern.test(value);
}

function isActivityAmount(value: unknown): value is ActivityAmount {
  if (!value || typeof value !== "object") return false;
  const amount = value as Partial<ActivityAmount>;
  return typeof amount.amount === "string" && typeof amount.symbol === "string";
}

function isRoutedSwapTracking(value: unknown): value is RoutedSwapTracking {
  if (!value || typeof value !== "object") return false;
  const tracking = value as Partial<RoutedSwapTracking> & Record<string, unknown>;
  return routedSwapLifecycles.includes(tracking.lifecycle as RoutedSwapLifecycle)
    && typeof tracking.quoteId === "string" && tracking.quoteId.length > 0
    && typeof tracking.routeProvider === "string" && tracking.routeProvider.length > 0
    && typeof tracking.sourceChainId === "number" && Number.isInteger(tracking.sourceChainId)
    && typeof tracking.destinationChainId === "number" && Number.isInteger(tracking.destinationChainId)
    && (tracking.approvalHash === undefined || isActivityHash(tracking.approvalHash))
    && (tracking.destinationHash === undefined || isActivityHash(tracking.destinationHash))
    && (tracking.providerDetail === undefined || typeof tracking.providerDetail === "string")
    && swapQuoteSchema.safeParse(tracking.quote).success;
}

function hasValidBase(record: Partial<ActivityBase>): boolean {
  return (record.status === "pending" || record.status === "success" || record.status === "failed"
    || record.status === "partial" || record.status === "refunded")
    && typeof record.id === "string"
    && typeof record.chainId === "number"
    && Number.isInteger(record.chainId)
    && typeof record.timestamp === "number"
    && Number.isFinite(record.timestamp)
    && (record.error === undefined || typeof record.error === "string")
    && (record.submitted === undefined || typeof record.submitted === "boolean")
    && (record.hash === undefined || isActivityHash(record.hash));
}

function isActivityRecord(value: unknown): value is ActivityRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ActivityRecord> & Record<string, unknown>;
  if (!hasValidBase(record)) return false;
  if (record.operation === "swap") {
    return isActivityAmount(record.input)
      && isActivityAmount(record.output)
      && (record.setId === undefined || typeof record.setId === "string")
      && (record.routed === undefined || isRoutedSwapTracking(record.routed));
  }
  if (record.operation === "deposit") {
    return (record.mode === "portfolio" || record.mode === "single-asset")
      && typeof record.setId === "string"
      && Array.isArray(record.deposits)
      && record.deposits.length > 0
      && record.deposits.every(isActivityAmount)
      && isActivityAmount(record.shares)
      && typeof record.lockDays === "number"
      && Number.isInteger(record.lockDays)
      && record.lockDays >= 0;
  }
  if (record.operation === "withdrawal") {
    return (record.mode === "proportional" || record.mode === "single-asset")
      && (record.setId === undefined || typeof record.setId === "string")
      && isActivityAmount(record.shares)
      && Array.isArray(record.outputs)
      && record.outputs.length > 0
      && record.outputs.every(isActivityAmount);
  }
  return false;
}

export function readActivity(storage: Pick<Storage, "getItem"> = localStorage): ActivityRecord[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isActivityRecord).sort((left, right) => right.timestamp - left.timestamp);
  } catch {
    return [];
  }
}

export function saveActivity(
  record: ActivityRecord,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  const records = readActivity(storage).filter((candidate) => candidate.id !== record.id);
  storage.setItem(STORAGE_KEY, JSON.stringify([record, ...records].slice(0, 100)));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ACTIVITY_EVENT));
}

export function updateActivity(
  id: string,
  changes: ActivityUpdate,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  const existing = readActivity(storage).find((record) => record.id === id);
  if (existing) saveActivity({ ...existing, ...changes }, storage);
}

export function markActivityPending(
  id: string,
  hash?: Hash,
  storage?: Pick<Storage, "getItem" | "setItem">,
): void {
  updateActivity(id, { hash, status: "pending", submitted: true }, storage);
}

export function markActivitySuccessful(
  id: string,
  hash?: Hash,
  storage?: Pick<Storage, "getItem" | "setItem">,
): void {
  updateActivity(id, { hash, status: "success", submitted: true }, storage);
}

export function markActivityFailed(
  id: string,
  error: string,
  hash?: Hash,
  storage?: Pick<Storage, "getItem" | "setItem">,
): void {
  updateActivity(id, { error, hash, status: "failed", ...(hash ? { submitted: true } : {}) }, storage);
}

/**
 * Advances the routed lifecycle of a swap record and keeps the top-level
 * status, transaction hashes, and provider detail in sync. Only a state that
 * carries a source hash marks the record as submitted.
 */
export function markRoutedSwapLifecycle(
  id: string,
  lifecycle: RoutedSwapLifecycle,
  changes: RoutedUpdate = {},
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  const existing = readActivity(storage).find((record) => record.id === id);
  if (!existing || existing.operation !== "swap" || !existing.routed) return;
  const routed: RoutedSwapTracking = {
    ...existing.routed,
    lifecycle,
    ...(changes.destinationHash !== undefined ? { destinationHash: changes.destinationHash } : {}),
    ...(changes.providerDetail !== undefined ? { providerDetail: changes.providerDetail } : {}),
  };
  saveActivity({
    ...existing,
    error: changes.error ?? existing.error,
    hash: changes.sourceHash ?? existing.hash,
    routed,
    status: routedLifecycleStatus(lifecycle),
    submitted: lifecycle !== "prepared" ? true : existing.submitted,
  }, storage);
}

/** Routed swaps that may still settle and should resume status polling. */
export function readResumableRoutedSwaps(
  storage: Pick<Storage, "getItem"> = localStorage,
): SwapActivityRecord[] {
  return readActivity(storage).filter((record): record is SwapActivityRecord => {
    if (record.operation !== "swap" || !record.routed) return false;
    return isResumableRoutedLifecycle(record.routed.lifecycle);
  });
}

export function createSwapActivity(
  input: Omit<SwapActivityRecord, "id" | "operation" | "timestamp">,
): SwapActivityRecord {
  return createActivity("swap", input);
}

export function createDepositActivity(
  input: Omit<DepositActivityRecord, "id" | "operation" | "timestamp">,
): DepositActivityRecord {
  return createActivity("deposit", input);
}

export function createWithdrawalActivity(
  input: Omit<WithdrawalActivityRecord, "id" | "operation" | "timestamp">,
): WithdrawalActivityRecord {
  return createActivity("withdrawal", input);
}

function createActivity<T extends ActivityRecord["operation"]>(
  operation: T,
  input: Omit<Extract<ActivityRecord, { operation: T }>, "id" | "operation" | "timestamp">,
): Extract<ActivityRecord, { operation: T }> {
  return {
    ...input,
    id: crypto.randomUUID(),
    operation,
    submitted: false,
    timestamp: Date.now(),
  } as Extract<ActivityRecord, { operation: T }>;
}

export function subscribeToActivity(listener: () => void): () => void {
  window.addEventListener(ACTIVITY_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(ACTIVITY_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
