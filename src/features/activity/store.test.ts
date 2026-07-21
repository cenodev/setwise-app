import {
  createDepositActivity,
  createSwapActivity,
  createWithdrawalActivity,
  markActivityFailed,
  markActivitySuccessful,
  readActivity,
  saveActivity,
} from "./store";

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
});
