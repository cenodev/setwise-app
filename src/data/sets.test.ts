import type { PoolSummary } from "./rfq/pools";
import { resolveSet, toSetDefinition } from "./sets";

const poolAddress = "0x1111111111111111111111111111111111111111";
const lpAddress = "0x2222222222222222222222222222222222222222";
const tokenAddress = "0x3333333333333333333333333333333333333333";

function summary(id: string, chainId = 97): PoolSummary {
  return {
    id,
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
