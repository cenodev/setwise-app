import type { Address } from "viem";

import type { Pool, PoolState } from "./rfq/deposits";
import type { PoolSummary } from "./rfq/pools";
import { loadPortfolioSetSnapshots, portfolioRegistryFingerprint } from "./portfolio";
import { toSetDefinition } from "./sets";

const at = "2026-07-21T10:00:00.000Z";

function address(value: number): Address {
  return `0x${value.toString(16).padStart(40, "0")}`;
}

function summary(id: string, chainId = 97): PoolSummary {
  return {
    assets: [{ address: address(3), decimals: 18, id: `${id}-asset`, index: 0, symbol: "A", weight: 100 }],
    chain: { id: chainId, name: `Chain ${chainId}` },
    contract: { address: address(Number(id.replace(/\D/g, "")) + 10) },
    display: { description: `Description for ${id}`, name: `Set ${id}`, sortOrder: 0 },
    id,
    lpToken: { address: address(2), decimals: 18, symbol: "SET" },
  };
}

function pool(definition: PoolSummary): Pool {
  return { ...definition, quotePolicy: { allowedLockDays: [0] } };
}

function state(definition: PoolSummary, blockNumber: string): PoolState {
  return {
    assets: [],
    blockNumber,
    blockTimestamp: at,
    chainId: definition.chain.id,
    poolAddress: definition.contract.address,
    poolId: definition.id,
    totalSupply: { amount: "1", atomicAmount: "1", decimals: 0 },
    totalValueUsd: "1",
    trading: { deposits: "available", paused: false },
  };
}

describe("portfolio Set loading", () => {
  it("limits concurrent Set loads and preserves different snapshot blocks", async () => {
    const summaries = [summary("set-1"), summary("set-2"), summary("set-3"), summary("set-4")];
    let active = 0;
    let maximum = 0;
    const loadPool = vi.fn(async (poolId: string) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      const match = summaries.find((item) => item.id === poolId);
      if (!match) throw new Error("missing fixture");
      return pool(match);
    });
    const loadState = vi.fn((poolId: string) => {
      const match = summaries.find((item) => item.id === poolId);
      return match
        ? Promise.resolve(state(match, `${100 + summaries.indexOf(match)}`))
        : Promise.reject(new Error("missing fixture"));
    });

    const result = await loadPortfolioSetSnapshots({
      concurrency: 2,
      definitions: summaries.map((item) => toSetDefinition(item, 97)),
      loadPool,
      loadState,
      nowMs: Date.parse(at),
      staleAfterMs: 60_000,
    });

    expect(maximum).toBeLessThanOrEqual(2);
    expect(result.map((item) => item.status)).toEqual(["ready", "ready", "ready", "ready"]);
    expect(result.flatMap((item) => "state" in item ? [item.state.blockNumber] : []))
      .toEqual(["100", "101", "102", "103"]);
  });

  it("does not load unsupported chains and contains individual Set failures", async () => {
    const good = summary("set-1");
    const bad = summary("set-2");
    const unsupported = summary("set-3", 56);
    const loadPool = vi.fn((poolId: string) => Promise.resolve(pool(poolId === good.id ? good : bad)));
    const loadState = vi.fn((poolId: string) => poolId === bad.id
      ? Promise.reject(new Error("state unavailable"))
      : Promise.resolve(state(good, "100")));

    const result = await loadPortfolioSetSnapshots({
      definitions: [good, bad, unsupported].map((item) => toSetDefinition(item, 97)),
      loadPool,
      loadState,
      nowMs: Date.parse(at),
      staleAfterMs: 60_000,
    });

    expect(result.map((item) => item.status)).toEqual(["ready", "error", "unsupported-chain"]);
    expect(loadPool).not.toHaveBeenCalledWith(unsupported.id);
    expect(loadState).not.toHaveBeenCalledWith(unsupported.id);
  });

  it("marks old snapshots stale and rejects cross-Set snapshot data", async () => {
    const first = summary("set-1");
    const second = summary("set-2");
    const result = await loadPortfolioSetSnapshots({
      definitions: [first, second].map((item) => toSetDefinition(item, 97)),
      loadPool: (poolId) => Promise.resolve(pool(poolId === first.id ? first : second)),
      loadState: (poolId) => Promise.resolve(poolId === first.id ? state(first, "100") : state(first, "200")),
      nowMs: Date.parse("2026-07-21T10:02:00.000Z"),
      staleAfterMs: 60_000,
    });

    expect(result.map((item) => item.status)).toEqual(["stale", "error"]);
  });

  it("changes the registry fingerprint on Set removal or definition changes", () => {
    const first = toSetDefinition(summary("set-1"), 97);
    const second = toSetDefinition(summary("set-2"), 97);
    const both = portfolioRegistryFingerprint([first, second]);

    expect(portfolioRegistryFingerprint([first])).not.toBe(both);
    expect(portfolioRegistryFingerprint([
      first,
      toSetDefinition({ ...second.pool, contract: { address: address(999) } }, 97),
    ])).not.toBe(both);
  });
});
