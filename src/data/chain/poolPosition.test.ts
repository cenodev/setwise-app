import type { Address } from "viem";

import type { Pool, PoolState } from "../rfq/deposits";
import {
  PoolPositionContextError,
  readWalletPoolPosition,
  walletPoolPositionQueryKey,
  type PoolPositionClient,
  type PoolPositionConnection,
} from "./poolPosition";

const account = "0x0000000000000000000000000000000000000001" as Address;
const otherAccount = "0x0000000000000000000000000000000000000002" as Address;
const poolAddress = "0x0000000000000000000000000000000000000010" as Address;
const lpToken = "0x0000000000000000000000000000000000000011" as Address;
const firstAsset = "0x0000000000000000000000000000000000000020" as Address;
const secondAsset = "0x0000000000000000000000000000000000000021" as Address;

const pool = {
  id: "pool",
  chain: { id: 97, name: "BSC Testnet" },
  contract: { address: poolAddress },
  lpToken: { address: lpToken, decimals: 18, symbol: "SETWISE" },
  quotePolicy: { allowedLockDays: [0, 30] },
  assets: [
    { address: firstAsset, decimals: 18, id: "FIRST", index: 0, symbol: "FIRST", weight: 1 },
    { address: secondAsset, decimals: 18, id: "SECOND", index: 1, symbol: "SECOND", weight: 1 },
  ],
} as Pool;

const poolState = {
  blockNumber: "123",
  chainId: 97,
  poolAddress,
  poolId: pool.id,
} as PoolState;

const connected: PoolPositionConnection = { account, chainId: 97, status: "connected" };

type MulticallInput = {
  allowFailure: boolean;
  blockNumber: bigint;
  contracts: readonly { address: Address; functionName: string }[];
};

function mockClient(results: readonly unknown[], nativeBalance = 0n) {
  const getBalance = vi.fn<(args: { address: Address; blockNumber: bigint }) => Promise<bigint>>()
    .mockResolvedValue(nativeBalance);
  const multicall = vi.fn<(args: MulticallInput) => Promise<readonly unknown[]>>()
    .mockResolvedValue(results);
  return {
    chain: { id: 97 },
    getBalance,
    multicall,
  } as unknown as PoolPositionClient & { getBalance: typeof getBalance; multicall: typeof multicall };
}

function input(client: PoolPositionClient, connection = connected) {
  return { client, connection, pool, poolState, requestedAccount: account };
}

describe("wallet pool-position reader", () => {
  it("returns unlocked-only shares separately and in the attributed total", async () => {
    const result = await readWalletPoolPosition(input(mockClient([10n, 20n, 5n, [0n, 0n], false])));

    expect(result).toMatchObject({
      status: "ready",
      position: { shares: { unlocked: 5n, locked: 0n, totalAttributed: 5n, canClaim: false } },
    });
  });

  it("counts locked-only shares as attributed liquidity", async () => {
    const result = await readWalletPoolPosition(input(mockClient([0n, 0n, 0n, [999n, 7n], false])));

    expect(result).toMatchObject({
      status: "ready",
      position: { shares: { unlocked: 0n, locked: 7n, lockedUntil: 999n, totalAttributed: 7n } },
    });
  });

  it("returns mixed shares and every wallet balance from one block-pinned batch", async () => {
    const client = mockClient([11n, 22n, 3n, [999n, 4n], false], 8n);
    const result = await readWalletPoolPosition(input(client));

    expect(result).toMatchObject({
      status: "ready",
      position: {
        assetBalances: [
          { assetId: "FIRST", address: firstAsset, balance: 11n },
          { assetId: "SECOND", address: secondAsset, balance: 22n },
        ],
        blockNumber: 123n,
        nativeBalance: 8n,
        shares: { unlocked: 3n, locked: 4n, totalAttributed: 7n },
      },
    });
    expect(client.multicall).toHaveBeenCalledOnce();
    const multicallInput = client.multicall.mock.calls[0]?.[0];
    expect(multicallInput).toMatchObject({ allowFailure: false, blockNumber: 123n });
    expect(multicallInput?.contracts.map(({ address, functionName }) => ({ address, functionName }))).toEqual([
      { address: firstAsset, functionName: "balanceOf" },
      { address: secondAsset, functionName: "balanceOf" },
      { address: lpToken, functionName: "balanceOf" },
      { address: poolAddress, functionName: "lockedDeposits" },
      { address: poolAddress, functionName: "canClaimShares" },
    ]);
    expect(client.getBalance).toHaveBeenCalledWith({ address: account, blockNumber: 123n });
  });

  it("returns claim eligibility", async () => {
    const result = await readWalletPoolPosition(input(mockClient([0n, 0n, 0n, [999n, 7n], true])));
    expect(result).toMatchObject({ status: "ready", position: { shares: { canClaim: true } } });
  });

  it("does not issue RPC reads while disconnected", async () => {
    const client = mockClient([]);
    const result = await readWalletPoolPosition({
      client,
      connection: { status: "disconnected" },
      pool,
      poolState,
    });

    expect(result).toEqual({ status: "disconnected" });
    expect(client.multicall).not.toHaveBeenCalled();
    expect(client.getBalance).not.toHaveBeenCalled();
  });

  it("represents a wrong network without issuing RPC reads", async () => {
    const client = mockClient([]);
    const result = await readWalletPoolPosition(input(client, { account, chainId: 1, status: "connected" }));

    expect(result).toEqual({
      account,
      actualChainId: 1,
      expectedChainId: 97,
      status: "wrong-network",
    });
    expect(client.multicall).not.toHaveBeenCalled();
    expect(client.getBalance).not.toHaveBeenCalled();
  });

  it("represents a complete zero-balance state explicitly", async () => {
    const result = await readWalletPoolPosition(input(mockClient([0n, 0n, 0n, [0n, 0n], false])));
    expect(result).toMatchObject({ status: "zero-balance" });
  });

  it("represents RPC failures explicitly", async () => {
    const client = mockClient([]);
    client.multicall.mockRejectedValue(new Error("RPC unavailable"));
    const result = await readWalletPoolPosition(input(client));

    expect(result).toMatchObject({ status: "rpc-error", blockNumber: 123n });
    if (result.status !== "rpc-error") throw new Error("Expected an RPC error state");
    expect(result.error.message).toBe("RPC unavailable");
  });

  it("rejects account and snapshot-chain mismatches before reading", async () => {
    const client = mockClient([]);
    await expect(readWalletPoolPosition({
      ...input(client),
      requestedAccount: otherAccount,
    })).rejects.toBeInstanceOf(PoolPositionContextError);
    await expect(readWalletPoolPosition({
      ...input(client),
      poolState: { ...poolState, chainId: 56 },
    })).rejects.toThrow(/snapshot does not match/);
    expect(client.multicall).not.toHaveBeenCalled();
  });

  it("rejects a public client for another chain", async () => {
    const client = mockClient([]);
    Object.assign(client, { chain: { id: 56 } });
    await expect(readWalletPoolPosition(input(client))).rejects.toThrow(/public client chain/);
    expect(client.multicall).not.toHaveBeenCalled();
  });

  it("changes the query key with the account and connected chain", () => {
    const first = walletPoolPositionQueryKey(input(mockClient([])));
    const nextAccount = walletPoolPositionQueryKey({
      ...input(mockClient([])),
      connection: { account: otherAccount, chainId: 97, status: "connected" },
      requestedAccount: otherAccount,
    });
    const nextChain = walletPoolPositionQueryKey({
      ...input(mockClient([])),
      connection: { account, chainId: 56, status: "connected" },
    });

    expect(nextAccount).not.toEqual(first);
    expect(nextChain).not.toEqual(first);
  });
});
