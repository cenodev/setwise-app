import { createSwapActivity, readActivity, saveActivity, updateActivity } from "./store";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("local activity store", () => {
  it("keeps atomic-safe display strings and updates a pending swap by id", () => {
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
    updateActivity("swap-1", { hash: `0x${"a".repeat(64)}`, status: "success" }, storage);

    expect(readActivity(storage)).toEqual([expect.objectContaining({
      hash: `0x${"a".repeat(64)}`,
      input: record.input,
      status: "success",
    })]);
  });

  it("ignores malformed persisted records", () => {
    const storage = memoryStorage();
    storage.setItem("setwise.local-activity.v1", JSON.stringify([{ operation: "swap" }, null]));
    expect(readActivity(storage)).toEqual([]);
  });

  it("creates a timestamped swap record", () => {
    const record = createSwapActivity({
      chainId: 97,
      input: { amount: "1", symbol: "USDT" },
      output: { amount: "2", symbol: "TOKEN" },
      status: "failed",
    });
    expect(record.id).toBeTruthy();
    expect(record.operation).toBe("swap");
    expect(record.timestamp).toBeGreaterThan(0);
  });
});
