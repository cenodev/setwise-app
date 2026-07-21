import type { PoolSummary } from "./rfq/pools";
import type { Pool, PoolState } from "./rfq/deposits";
import { resolveSet, toSetDefinition, validateSetSnapshot } from "./sets";

const poolAddress = "0x1111111111111111111111111111111111111111";
const lpAddress = "0x2222222222222222222222222222222222222222";
const tokenAddress = "0x3333333333333333333333333333333333333333";

function summary(id: string, chainId = 97): PoolSummary {
  return {
    id,
    display: { name: `Set ${id}`, description: `Description for ${id}`, sortOrder: 0 },
    chain: { id: chainId, name: chainId === 97 ? "BSC Testnet" : "Ethereum" },
    contract: { address: poolAddress },
    lpToken: { symbol: "SETWISE", decimals: 18, address: lpAddress },
    assets: [
      { id: "USDT", symbol: "mUSDT", address: tokenAddress, decimals: 6, weight: 5000, index: 0 },
    ],
  };
}

describe("toSetDefinition", () => {
  it("marks a pool on the supported chain as supported", () => {
    const def = toSetDefinition(summary("pool-a", 97), 97);
    expect(def.id).toBe("pool-a");
    expect(def.chainId).toBe(97);
    expect(def.supported).toBe(true);
  });

  it("marks a pool on a different chain as unsupported", () => {
    const def = toSetDefinition(summary("pool-eth", 1), 97);
    expect(def.chainId).toBe(1);
    expect(def.supported).toBe(false);
  });
});

describe("resolveSet", () => {
  const pools = [summary("pool-a"), summary("pool-b"), summary("pool-eth", 1)];

  it("returns loading when the registry has not arrived", () => {
    expect(resolveSet("pool-a", undefined, 97)).toEqual({ status: "loading" });
  });

  it("resolves a known pool on the supported chain to ready", () => {
    const result = resolveSet("pool-a", pools, 97);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.definition.id).toBe("pool-a");
      expect(result.definition.supported).toBe(true);
    }
  });

  it("returns not-found for an unknown pool ID", () => {
    const result = resolveSet("nonexistent", pools, 97);
    expect(result).toEqual({ poolId: "nonexistent", status: "not-found" });
  });

  it("returns unsupported-chain for a valid pool on a different chain", () => {
    const result = resolveSet("pool-eth", pools, 97);
    expect(result.status).toBe("unsupported-chain");
    if (result.status === "unsupported-chain") {
      expect(result.definition.id).toBe("pool-eth");
      expect(result.definition.chainId).toBe(1);
    }
  });

  it("returns not-found when the registry is empty", () => {
    expect(resolveSet("pool-a", [], 97)).toEqual({ poolId: "pool-a", status: "not-found" });
  });
});

describe("validateSetSnapshot", () => {
  const definition = toSetDefinition(summary("pool-a"), 97);
  const pool = {
    ...definition.pool,
    quotePolicy: { allowedLockDays: [0] },
  } as Pool;
  const state = {
    poolId: "pool-a",
    chainId: 97,
    poolAddress,
    blockNumber: "1",
    blockTimestamp: "2026-07-21T12:00:00.000Z",
    trading: { paused: false, deposits: "available" },
    totalValueUsd: "1",
    totalSupply: { amount: "1", atomicAmount: "1", decimals: 0 },
    assets: [],
  } as PoolState;

  it("accepts a route-selected registry, detail, and state snapshot", () => {
    expect(validateSetSnapshot("pool-a", definition, pool, state)).toBeNull();
  });

  it.each([
    ["route ID", "pool-b", pool, state],
    ["detail ID", "pool-a", { ...pool, id: "pool-b" }, state],
    ["state ID", "pool-a", pool, { ...state, poolId: "pool-b" }],
    ["chain", "pool-a", pool, { ...state, chainId: 1 }],
    ["contract", "pool-a", pool, { ...state, poolAddress: "0x9999999999999999999999999999999999999999" }],
  ])("rejects a mismatched %s", (_label, routeId, detail, snapshot) => {
    expect(validateSetSnapshot(routeId, definition, detail as Pool, snapshot as PoolState)).toMatchObject({
      name: "SetSnapshotMismatchError",
    });
  });
});
