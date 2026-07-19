import type { Hash } from "viem";

const STORAGE_KEY = "setwise.local-activity.v1";
const ACTIVITY_EVENT = "setwise:activity-updated";

export type ActivityStatus = "pending" | "success" | "failed";

export type ActivityRecord = {
  chainId: number;
  error?: string;
  hash?: Hash;
  id: string;
  input: { amount: string; symbol: string };
  operation: "swap";
  output: { amount: string; symbol: string };
  status: ActivityStatus;
  timestamp: number;
};

function isActivityRecord(value: unknown): value is ActivityRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ActivityRecord>;
  return record.operation === "swap"
    && (record.status === "pending" || record.status === "success" || record.status === "failed")
    && typeof record.id === "string"
    && typeof record.chainId === "number"
    && typeof record.timestamp === "number"
    && typeof record.input?.amount === "string"
    && typeof record.input.symbol === "string"
    && typeof record.output?.amount === "string"
    && typeof record.output.symbol === "string"
    && (record.hash === undefined || /^0x[0-9a-fA-F]{64}$/.test(record.hash));
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
  changes: Partial<Pick<ActivityRecord, "error" | "hash" | "status">>,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  const existing = readActivity(storage).find((record) => record.id === id);
  if (existing) saveActivity({ ...existing, ...changes }, storage);
}

export function createSwapActivity(input: Omit<ActivityRecord, "id" | "operation" | "timestamp">): ActivityRecord {
  return {
    ...input,
    id: crypto.randomUUID(),
    operation: "swap",
    timestamp: Date.now(),
  };
}

export function subscribeToActivity(listener: () => void): () => void {
  window.addEventListener(ACTIVITY_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(ACTIVITY_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
