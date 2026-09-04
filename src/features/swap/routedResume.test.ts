import { describe, expect, it, vi } from "vitest";

import { sameChainQuote } from "../../data/swapRouter/fixtures";
import type { SwapExecutionStatus } from "../../data/swapRouter/schema";
import {
  createSwapActivity,
  markRoutedSwapLifecycle,
  readActivity,
  saveActivity,
} from "../activity/store";
import {
  MAX_TRACKING_AGE_MS,
  isStaleForTracking,
  pollResumableRoutedSwaps,
} from "./routedResume";

const SOURCE_HASH = `0x${"c".repeat(64)}` as `0x${string}`;
const DESTINATION_HASH = `0x${"d".repeat(64)}` as `0x${string}`;

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

function seedResumable(storage: ReturnType<typeof memoryStorage>) {
  const record = createSwapActivity({
    chainId: 56,
    input: { amount: "25", symbol: "USDC" },
    output: { amount: "24.9125", symbol: "USDT" },
    routed: {
      destinationChainId: 56,
      lifecycle: "source-submitted",
      quote: sameChainQuote,
      quoteId: sameChainQuote.quoteId,
      routeProvider: sameChainQuote.providerId,
      sourceChainId: 56,
    },
    status: "pending",
  });
  saveActivity(record, storage);
  markRoutedSwapLifecycle(record.id, "source-submitted", { sourceHash: SOURCE_HASH }, storage);
  return record;
}

function statusFixture(state: SwapExecutionStatus["state"]): SwapExecutionStatus {
  return {
    detail: null,
    destinationTransaction: state === "confirmed" ? { chainId: 56, hash: DESTINATION_HASH } : null,
    intent: sameChainQuote.intent,
    providerId: sameChainQuote.providerId,
    quoteId: sameChainQuote.quoteId,
    state,
    transaction: state === "expired" ? null : { chainId: 56, hash: SOURCE_HASH },
    updatedAt: new Date().toISOString(),
  };
}

function routedRecord(storage: ReturnType<typeof memoryStorage>, id?: string, index = 0) {
  const record = id
    ? readActivity(storage).find((candidate) => candidate.id === id)
    : readActivity(storage)[index];
  if (!record || record.operation !== "swap" || !record.routed) throw new Error("missing routed record");
  const routed = record.routed;
  return { ...record, routed };
}

describe("pollResumableRoutedSwaps", () => {
  it("advances a resumable swap to destination-pending while the provider reports pending", async () => {
    const storage = memoryStorage();
    const record = seedResumable(storage);
    const requestStatus = vi.fn().mockResolvedValue(statusFixture("pending"));

    await pollResumableRoutedSwaps({ requestStatus, storage });

    expect(requestStatus).toHaveBeenCalledWith({ quote: sameChainQuote, transactionHash: SOURCE_HASH });
    const pendingRecord = routedRecord(storage);
    expect(pendingRecord.routed.lifecycle).toBe("destination-pending");
    expect(pendingRecord.status).toBe("pending");
    expect(record.id).toBe(pendingRecord.id);
  });

  it("records delivered evidence with the destination transaction", async () => {
    const storage = memoryStorage();
    seedResumable(storage);
    const requestStatus = vi.fn().mockResolvedValue(statusFixture("confirmed"));

    await pollResumableRoutedSwaps({ requestStatus, storage });

    const record = routedRecord(storage);
    expect(record.status).toBe("success");
    expect(record.routed.lifecycle).toBe("delivered");
    expect(record.routed.destinationHash).toBe(DESTINATION_HASH);
  });

  it("records refunds and failures without receipt claims and stops polling them", async () => {
    const storage = memoryStorage();
    seedResumable(storage);
    const requestStatus = vi.fn().mockResolvedValue(statusFixture("refunded"));

    await pollResumableRoutedSwaps({ requestStatus, storage });

    expect(readActivity(storage)[0]?.status).toBe("refunded");

    const secondPass = vi.fn().mockResolvedValue(statusFixture("confirmed"));
    await pollResumableRoutedSwaps({ requestStatus: secondPass, storage });
    expect(secondPass).not.toHaveBeenCalled();
  });

  it("keeps the record resumable and annotated when the provider is unreachable", async () => {
    const storage = memoryStorage();
    seedResumable(storage);
    const requestStatus = vi.fn().mockRejectedValue(new Error("Swap router is unavailable"));

    await pollResumableRoutedSwaps({ requestStatus, storage });

    expect(routedRecord(storage).routed.lifecycle).toBe("unknown");
    expect(routedRecord(storage).routed.providerDetail).toMatch(/unavailable/i);
    expect(routedRecord(storage).status).toBe("pending");

    const recovery = vi.fn().mockResolvedValue(statusFixture("confirmed"));
    await pollResumableRoutedSwaps({ requestStatus: recovery, storage });
    expect(routedRecord(storage).routed.lifecycle).toBe("delivered");
  });

  it("skips settled records and swaps that exceeded the tracking window", async () => {
    const storage = memoryStorage();
    const record = seedResumable(storage);
    const settled = {
      ...createSwapActivity({
        chainId: 56,
        input: { amount: "25", symbol: "USDC" },
        output: { amount: "24.9125", symbol: "USDT" },
        routed: {
          destinationChainId: 56,
          lifecycle: "source-submitted",
          quote: sameChainQuote,
          quoteId: sameChainQuote.quoteId,
          routeProvider: sameChainQuote.providerId,
          sourceChainId: 56,
        },
        status: "pending",
      }),
      id: "settled-record",
    };
    saveActivity(settled, storage);
    markRoutedSwapLifecycle(settled.id, "delivered", { destinationHash: DESTINATION_HASH }, storage);
    // Age the resumable record beyond the tracking window.
    const aged = routedRecord(storage, record.id);
    saveActivity({ ...aged, timestamp: Date.now() - MAX_TRACKING_AGE_MS - 1 }, storage);

    const requestStatus = vi.fn().mockResolvedValue(statusFixture("confirmed"));
    await pollResumableRoutedSwaps({ requestStatus, storage });

    expect(requestStatus).not.toHaveBeenCalled();
    const agedRecord = routedRecord(storage, record.id);
    expect(agedRecord.routed.lifecycle).toBe("source-submitted");
    expect(isStaleForTracking({ ...agedRecord, timestamp: Date.now() }, Date.now())).toBe(false);
  });
});
