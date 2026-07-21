import { describe, expect, it } from "vitest";
import type { Address } from "viem";

import type { Pool, PoolState } from "../../data/rfq/deposits";
import type { PoolSummary } from "../../data/rfq/pools";
import { toSetDefinition } from "../../data/sets";
import type { PortfolioSetView } from "./usePortfolio";
import {
  derivePublicSummary,
  deriveWalletSummary,
  setLockClaimStatus,
  setLpShares,
  setOwnership,
  unlockStatus,
} from "./presentation";

const account = "0x0000000000000000000000000000000000000001" as Address;

function address(value: number): Address {
  return `0x${value.toString(16).padStart(40, "0")}`;
}

function readySet(id: string, offset: number, paused = false): PortfolioSetView {
  const summary = {
    assets: [
      {
        address: address(offset + 3),
        decimals: 6,
        id: `${id}-usdt`,
        index: 0,
        symbol: "USDT",
        weight: 100,
      },
    ],
    chain: { id: 97, name: "BSC Testnet" },
    contract: { address: address(offset + 1) },
    id,
    lpToken: { address: address(offset + 2), decimals: 6, symbol: "SET" },
  } as PoolSummary;
  const definition = toSetDefinition(summary, 97);
  const pool = { ...summary, quotePolicy: { allowedLockDays: [0] } } as Pool;
  const state = {
    blockNumber: "100",
    blockTimestamp: "2026-07-21T10:00:00.000Z",
    chainId: 97,
    poolAddress: summary.contract.address,
    poolId: id,
    totalSupply: { amount: "10", atomicAmount: "10000000", decimals: 6 },
    totalValueUsd: "100",
    trading: { paused, deposits: paused ? "paused" : "available" },
  } as PoolState;
  return {
    snapshot: { definition, pool, state, status: "ready" },
    wallet: {
      poolId: id,
      position: {
        account,
        assetBalances: [],
        blockNumber: 100n,
        chainId: 97,
        nativeBalance: 0n,
        shares: {
          canClaim: false,
          locked: 2_000_000n,
          lockedUntil: 0n,
          totalAttributed: 5_000_000n,
          unlocked: 3_000_000n,
        },
      },
      status: "ready",
    },
  };
}

describe("portfolio presentation", () => {
  it("counts active, paused, and unique constituents", () => {
    const summary = derivePublicSummary([
      readySet("set-a", 10, false),
      readySet("set-b", 20, true),
      {
        snapshot: {
          definition: readySet("set-c", 30).snapshot.definition,
          error: new Error("down"),
          status: "error",
        },
      },
    ]);

    expect(summary).toEqual({
      activeSets: 1,
      pausedSets: 1,
      constituentCount: 2,
      coveredSets: 2,
      totalSets: 3,
    });
  });

  it("derives owned Sets and unlocked/locked USD without inventing zeros for missing Sets", () => {
    const owned = readySet("set-a", 10);
    const missing: PortfolioSetView = {
      snapshot: {
        definition: readySet("set-b", 20).snapshot.definition,
        error: new Error("rpc"),
        status: "error",
      },
      wallet: { error: new Error("rpc"), poolId: "set-b", status: "error" },
    };

    const stats = deriveWalletSummary([owned, missing]);
    expect(stats.ownedSets).toBe(1);
    expect(stats.unlockedValue).toEqual({ numerator: 30n, denominator: 1n });
    expect(stats.lockedValue).toEqual({ numerator: 20n, denominator: 1n });
    expect(stats.unlockedPartial).toBe(true);
    expect(stats.lockedPartial).toBe(true);
  });

  it("formats ownership, LP shares, and lock status for a Set position", () => {
    const set = readySet("set-a", 10);
    expect(setOwnership(set)).toBe("50.0000%");
    expect(setLpShares(set)).toBe("5 SET");
    expect(setLockClaimStatus(set)).toBe("Locked");
    expect(unlockStatus(0n, 0n, false)).toBe("No locked shares");
    expect(unlockStatus(1n, 0n, true)).toBe("Claimable now");
  });
});
