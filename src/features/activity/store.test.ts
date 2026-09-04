import { sameChainQuote } from "../../data/swapRouter/fixtures";
import {
  createDepositActivity,
  createSwapActivity,
  createWithdrawalActivity,
  markActivityFailed,
  markActivityPending,
  markActivitySuccessful,
  markRoutedSwapLifecycle,
  readActivity,
  readResumableRoutedSwaps,
  saveActivity,
} from "./store";

const SOURCE_HASH: `0x${string}` = `0x${"c".repeat(64)}`;
const DESTINATION_HASH: `0x${string}` = `0x${"d".repeat(64)}`;

function routedTracking() {
  return {
    destinationChainId: 56,
    lifecycle: "prepared" as const,
    quote: sameChainQuote,
    quoteId: sameChainQuote.quoteId,
    routeProvider: sameChainQuote.providerId,
    sourceChainId: 56,
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("local activity store", () => {
  it("preserves a legacy swap and updates it by id", () => {
    const storage = memoryStorage();
    const record = {
      chainId: 97,
      id: "swap-1",
      input: { amount: "10.123456789123456789", symbol: "USDT" },
      operation: "swap" as const,
      output: { amount: "2", symbol: "TOKEN" },
      status: "pending" as const,
      timestamp: 1,
    };

    saveActivity(record, storage);
    markActivitySuccessful("swap-1", `0x${"a".repeat(64)}`, storage);

    expect(readActivity(storage)).toEqual([expect.objectContaining({
      hash: `0x${"a".repeat(64)}`,
      input: record.input,
      status: "success",
      submitted: true,
    })]);
  });

  it("preserves withdrawal records written before Set identity was recorded", () => {
    const storage = memoryStorage();
    const legacyWithdrawal = {
      chainId: 97,
      id: "legacy-withdrawal",
      mode: "proportional",
      operation: "withdrawal",
      outputs: [{ amount: "0.5", symbol: "USDT" }],
      shares: { amount: "1", symbol: "SETWISE" },
      status: "success",
      timestamp: 1,
    };
    storage.setItem("setwise.local-activity.v1", JSON.stringify([legacyWithdrawal]));

    expect(readActivity(storage)).toEqual([legacyWithdrawal]);
  });

  it("isolates malformed records without losing valid history", () => {
    const storage = memoryStorage();
    const valid = createSwapActivity({
      chainId: 97,
      input: { amount: "1", symbol: "USDT" },
      output: { amount: "2", symbol: "TOKEN" },
      status: "success",
    });
    storage.setItem("setwise.local-activity.v1", JSON.stringify([
      { operation: "swap" },
      valid,
      { ...valid, id: "bad-hash", hash: "0x1234" },
      null,
    ]));

    expect(readActivity(storage)).toEqual([valid]);
  });

  it("creates swap activity with Set identity and finalizes Router hash once", () => {
    const storage = memoryStorage();
    const swap = createSwapActivity({
      chainId: 97,
      input: { amount: "10", symbol: "USDT" },
      output: { amount: "2", symbol: "TOKEN" },
      setId: "set-a",
      status: "pending",
    });
    saveActivity(swap, storage);
    markActivityPending(swap.id, `0x${"b".repeat(64)}`, storage);
    markActivitySuccessful(swap.id, `0x${"b".repeat(64)}`, storage);

    const records = readActivity(storage);
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(expect.objectContaining({
      hash: `0x${"b".repeat(64)}`,
      setId: "set-a",
      status: "success",
      submitted: true,
    }));
  });

  it("creates typed deposit and withdrawal records and shares failure updates", () => {
    const storage = memoryStorage();
    const deposit = createDepositActivity({
      chainId: 97,
      deposits: [{ amount: "1", symbol: "USDT" }],
      lockDays: 30,
      mode: "single-asset",
      setId: "set-1",
      shares: { amount: "0.99", symbol: "SETWISE" },
      status: "pending",
    });
    const withdrawal = createWithdrawalActivity({
      chainId: 97,
      mode: "proportional",
      outputs: [{ amount: "0.5", symbol: "USDT" }],
      setId: "set-1",
      shares: { amount: "1", symbol: "SETWISE" },
      status: "pending",
    });

    saveActivity(deposit, storage);
    saveActivity(withdrawal, storage);
    markActivityFailed(withdrawal.id, "Rejected in wallet", undefined, storage);

    expect(readActivity(storage)).toEqual(expect.arrayContaining([
      expect.objectContaining({ lockDays: 30, operation: "deposit" }),
      expect.objectContaining({ error: "Rejected in wallet", operation: "withdrawal", status: "failed", submitted: false }),
    ]));
  });

  it("sorts newest first and caps persisted history", () => {
    const storage = memoryStorage();
    for (let index = 0; index < 105; index += 1) {
      saveActivity({
        chainId: 97,
        id: `swap-${index}`,
        input: { amount: "1", symbol: "USDT" },
        operation: "swap",
        output: { amount: "2", symbol: "TOKEN" },
        status: "success",
        timestamp: index,
      }, storage);
    }

    const records = readActivity(storage);
    expect(records).toHaveLength(100);
    expect(records[0]?.timestamp).toBe(104);
    expect(records.at(-1)?.timestamp).toBe(5);
  });

  it("persists routed swap evidence and advances the lifecycle without losing it", () => {
    const storage = memoryStorage();
    const routed = createSwapActivity({
      chainId: 56,
      input: { amount: "25", symbol: "USDC" },
      output: { amount: "24.9125", symbol: "USDT" },
      routed: routedTracking(),
      status: "pending",
    });
    saveActivity(routed, storage);

    markRoutedSwapLifecycle(routed.id, "source-submitted", { sourceHash: SOURCE_HASH }, storage);
    markRoutedSwapLifecycle(routed.id, "destination-pending", {}, storage);
    markRoutedSwapLifecycle(routed.id, "delivered", { destinationHash: DESTINATION_HASH }, storage);

    const [stored] = readActivity(storage);
    expect(stored).toEqual(expect.objectContaining({
      hash: SOURCE_HASH,
      status: "success",
      submitted: true,
    }));
    if (!stored || stored.operation !== "swap" || !stored.routed) throw new Error("missing routed record");
    expect(stored.routed).toEqual(expect.objectContaining({
      destinationChainId: 56,
      destinationHash: DESTINATION_HASH,
      lifecycle: "delivered",
      quoteId: sameChainQuote.quoteId,
      routeProvider: sameChainQuote.providerId,
      sourceChainId: 56,
    }));
  });

  it("never marks settled-out routed states as receipt of the output", () => {
    const storage = memoryStorage();
    const routed = createSwapActivity({
      chainId: 56,
      input: { amount: "25", symbol: "USDC" },
      output: { amount: "24.9125", symbol: "USDT" },
      routed: routedTracking(),
      status: "pending",
    });
    saveActivity(routed, storage);
    markRoutedSwapLifecycle(routed.id, "source-submitted", { sourceHash: SOURCE_HASH }, storage);

    markRoutedSwapLifecycle(routed.id, "refunded", { providerDetail: "input refunded" }, storage);
    expect(readActivity(storage)[0]).toEqual(expect.objectContaining({ status: "refunded" }));

    markRoutedSwapLifecycle(routed.id, "failed", { providerDetail: "reverted" }, storage);
    expect(readActivity(storage)[0]).toEqual(expect.objectContaining({ status: "failed" }));

    markRoutedSwapLifecycle(routed.id, "partially-delivered", {}, storage);
    expect(readActivity(storage)[0]).toEqual(expect.objectContaining({ status: "partial" }));
  });

  it("treats unknown lifecycle states as resumable and drops malformed routed records", () => {
    const storage = memoryStorage();
    const resumable = createSwapActivity({
      chainId: 56,
      input: { amount: "25", symbol: "USDC" },
      output: { amount: "24.9125", symbol: "USDT" },
      routed: { ...routedTracking(), lifecycle: "destination-pending" as const },
      status: "pending",
    });
    saveActivity(resumable, storage);
    const settled = {
      ...createSwapActivity({
        chainId: 56,
        input: { amount: "25", symbol: "USDC" },
        output: { amount: "24.9125", symbol: "USDT" },
        routed: { ...routedTracking(), lifecycle: "delivered" as const },
        status: "pending",
      }),
      id: "settled",
    };
    saveActivity(settled, storage);
    const broken = {
      ...createSwapActivity({
        chainId: 56,
        input: { amount: "25", symbol: "USDC" },
        output: { amount: "24.9125", symbol: "USDT" },
        routed: {
          ...routedTracking(),
          lifecycle: "unknown" as const,
          quote: { nope: true } as unknown as typeof sameChainQuote,
        },
        status: "pending",
      }),
      id: "broken",
    };
    saveActivity(broken, storage);

    // The malformed routed payload fails closed: the record is dropped rather
    // than displayed as a legacy swap that received its output.
    expect(readActivity(storage).map((record) => record.id).sort()).toEqual([resumable.id, settled.id].sort());
    expect(readResumableRoutedSwaps(storage)).toEqual([expect.objectContaining({ id: resumable.id })]);
  });

  it("keeps legacy swap records readable when the routed payload is absent", () => {
    const storage = memoryStorage();
    const record = {
      chainId: 97,
      id: "legacy-swap",
      input: { amount: "10", symbol: "USDT" },
      operation: "swap" as const,
      output: { amount: "2", symbol: "TOKEN" },
      status: "pending" as const,
      timestamp: 1,
    };
    saveActivity(record, storage);
    markRoutedSwapLifecycle("legacy-swap", "delivered", {}, storage);
    expect(readActivity(storage)[0]).toEqual(expect.objectContaining({ id: "legacy-swap", status: "pending" }));
  });
});
