import type { Hash } from "viem";

const STORAGE_KEY = "setwise.local-activity.v1";
const ACTIVITY_EVENT = "setwise:activity-updated";

export type ActivityStatus = "pending" | "success" | "failed";
export type ActivityAmount = { amount: string; symbol: string };

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
  setId: string;
  shares: ActivityAmount;
};

export type ActivityRecord = SwapActivityRecord | DepositActivityRecord | WithdrawalActivityRecord;
type ActivityUpdate = Partial<Pick<ActivityBase, "error" | "hash" | "status" | "submitted">>;

function isActivityAmount(value: unknown): value is ActivityAmount {
  if (!value || typeof value !== "object") return false;
  const amount = value as Partial<ActivityAmount>;
  return typeof amount.amount === "string" && typeof amount.symbol === "string";
}

function hasValidBase(record: Partial<ActivityBase>): boolean {
  return (record.status === "pending" || record.status === "success" || record.status === "failed")
    && typeof record.id === "string"
    && typeof record.chainId === "number"
    && Number.isInteger(record.chainId)
    && typeof record.timestamp === "number"
    && Number.isFinite(record.timestamp)
    && (record.error === undefined || typeof record.error === "string")
    && (record.submitted === undefined || typeof record.submitted === "boolean")
    && (record.hash === undefined || /^0x[0-9a-fA-F]{64}$/.test(record.hash));
}

function isActivityRecord(value: unknown): value is ActivityRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ActivityRecord> & Record<string, unknown>;
  if (!hasValidBase(record)) return false;
  if (record.operation === "swap") {
    return isActivityAmount(record.input)
      && isActivityAmount(record.output)
      && (record.setId === undefined || typeof record.setId === "string");
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
      && typeof record.setId === "string"
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
