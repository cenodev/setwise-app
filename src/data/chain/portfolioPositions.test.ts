import type { Address } from "viem";

import type { Pool, PoolState } from "../rfq/deposits";
import {
  portfolioWalletPositionsQueryKey,
  readPortfolioWalletPositions,
  type PortfolioPoolSnapshot,
} from "./portfolioPositions";
import type { PoolPositionClient, PoolPositionConnection } from "./poolPosition";

const account = "0x0000000000000000000000000000000000000001" as Address;
const nextAccount = "0x0000000000000000000000000000000000000002" as Address;
const connected: PoolPositionConnection = { account, chainId: 97, status: "connected" };

function address(value: number): Address {
  return `0x${value.toString(16).padStart(40, "0")}`;
}

function snapshot(id: string, blockNumber: string, offset: number, chainId = 97): PortfolioPoolSnapshot {
  const pool = {
    assets: [{ address: address(offset + 3), decimals: offset === 0 ? 18 : 6, id: `${id}-asset`, index: 0, symbol: "A", weight: 100 }],
    chain: { id: chainId, name: `Chain ${chainId}` },
    contract: { address: address(offset + 1) },
    id,
    lpToken: { address: address(offset + 2), decimals: offset === 0 ? 18 : 6, symbol: "SET" },
    quotePolicy: { allowedLockDays: [0] },
  } as Pool;
  return {
    pool,
    state: {
      blockNumber,
      chainId,
      poolAddress: pool.contract.address,
      poolId: id,
    } as PoolState,
    status: "ready",
  };
}

type MulticallInput = { blockNumber: bigint };

function client(chainId: number, results: readonly unknown[]) {
  const getBalance = vi.fn<() => Promise<bigint>>().mockResolvedValue(0n);
  const multicall = vi.fn<(input: MulticallInput) => Promise<readonly unknown[]>>().mockResolvedValue(results);
  return {
    chain: { id: chainId },
    getBalance,
    multicall,
  } as unknown as PoolPositionClient & {
    getBalance: typeof getBalance;
    multicall: typeof multicall;
  };
}

describe("portfolio wallet-position reader", () => {
  it("batches compatible Sets at the same chain and snapshot block", async () => {
    const first = snapshot("set-a", "100", 10);
    const second = snapshot("set-b", "100", 20);
    const publicClient = client(97, [1n, 4n, [0n, 2n], false, 3n, 5n, [0n, 0n], true]);

    const result = await readPortfolioWalletPositions({
      clients: new Map([[97, publicClient]]),
      connection: connected,
      snapshots: [first, second],
      supportedChainIds: new Set([97]),
    });

    expect(publicClient.multicall).toHaveBeenCalledOnce();
    expect(publicClient.getBalance).toHaveBeenCalledOnce();
    expect(publicClient.multicall.mock.calls[0]?.[0]).toMatchObject({ blockNumber: 100n });
    expect(result).toMatchObject([
      { poolId: "set-a", position: { blockNumber: 100n, shares: { totalAttributed: 6n } }, status: "ready" },
      { poolId: "set-b", position: { blockNumber: 100n, shares: { totalAttributed: 5n } }, status: "ready" },
    ]);
  });

  it("keeps different snapshot blocks in independent batches", async () => {
    const first = snapshot("set-a", "100", 10);
    const second = snapshot("set-b", "200", 20);
    const publicClient = client(97, []);
    publicClient.multicall.mockImplementation(({ blockNumber }) => Promise.resolve(blockNumber === 100n
        ? [0n, 1n, [0n, 0n], false]
        : [0n, 2n, [0n, 0n], false]));

    const result = await readPortfolioWalletPositions({
      clients: new Map([[97, publicClient]]),
      connection: connected,
      snapshots: [first, second],
      supportedChainIds: new Set([97]),
    });

    expect(publicClient.multicall).toHaveBeenCalledTimes(2);
    expect(publicClient.getBalance).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject([
      { position: { blockNumber: 100n, shares: { totalAttributed: 1n } }, status: "ready" },
      { position: { blockNumber: 200n, shares: { totalAttributed: 2n } }, status: "ready" },
    ]);
  });

  it("contains a failed block batch without erasing another Set", async () => {
    const first = snapshot("set-a", "100", 10);
    const second = snapshot("set-b", "200", 20);
    const publicClient = client(97, []);
    publicClient.multicall.mockImplementation(({ blockNumber }) => blockNumber === 100n
      ? Promise.reject(new Error("block 100 unavailable"))
      : Promise.resolve([0n, 2n, [0n, 0n], false]));

    const result = await readPortfolioWalletPositions({
      clients: new Map([[97, publicClient]]),
      connection: connected,
      snapshots: [first, second],
      supportedChainIds: new Set([97]),
    });

    expect(result[0]).toMatchObject({ poolId: "set-a", status: "error" });
    expect(result[1]).toMatchObject({ poolId: "set-b", status: "ready" });
  });

  it("returns disconnected and unsupported-chain states without reads", async () => {
    const supported = snapshot("set-a", "100", 10);
    const unsupported = snapshot("set-mainnet", "300", 30, 56);
    const publicClient = client(97, []);

    const disconnected = await readPortfolioWalletPositions({
      clients: new Map([[97, publicClient]]),
      connection: { status: "disconnected" },
      snapshots: [supported, unsupported],
      supportedChainIds: new Set([97]),
    });
    expect(disconnected.map((result) => result.status)).toEqual(["disconnected", "disconnected"]);

    const connectedResult = await readPortfolioWalletPositions({
      clients: new Map([[97, publicClient]]),
      connection: connected,
      snapshots: [unsupported],
      supportedChainIds: new Set([97]),
    });
    expect(connectedResult).toEqual([{ chainId: 56, poolId: "set-mainnet", status: "unsupported-chain" }]);
    expect(publicClient.multicall).not.toHaveBeenCalled();
  });

  it("keys cached wallet data by account, chain, Set, and snapshot block", () => {
    const first = snapshot("set-a", "100", 10);
    const original = portfolioWalletPositionsQueryKey({ connection: connected, snapshots: [first] });
    const accountChanged = portfolioWalletPositionsQueryKey({
      connection: { account: nextAccount, chainId: 97, status: "connected" },
      snapshots: [first],
    });
    const chainChanged = portfolioWalletPositionsQueryKey({
      connection: { account, chainId: 56, status: "connected" },
      snapshots: [first],
    });
    const blockChanged = portfolioWalletPositionsQueryKey({
      connection: connected,
      snapshots: [{ ...first, state: { ...first.state, blockNumber: "101" } }],
    });

    expect(accountChanged).not.toEqual(original);
    expect(chainChanged).not.toEqual(original);
    expect(blockChanged).not.toEqual(original);
  });
});
