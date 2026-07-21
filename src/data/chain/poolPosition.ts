import {
  isAddressEqual,
  type Address,
  type PublicClient,
} from "viem";

import type { Pool, PoolState } from "../rfq/deposits";
import { erc20Abi, setwisePoolAbi } from "./abis";

export type PoolPositionConnection =
  | { status: "disconnected" }
  | { account: Address; chainId: number; status: "connected" };

export type PoolPositionClient = Pick<PublicClient, "chain" | "getBalance" | "multicall">;

export type WalletAssetBalance = {
  address: Address;
  assetId: string;
  balance: bigint;
};

export type WalletPoolPosition = {
  account: Address;
  assetBalances: WalletAssetBalance[];
  blockNumber: bigint;
  chainId: number;
  nativeBalance: bigint;
  shares: {
    canClaim: boolean;
    locked: bigint;
    lockedUntil: bigint;
    totalAttributed: bigint;
    unlocked: bigint;
  };
};

export type WalletPoolPositionState =
  | { status: "disconnected" }
  | { account: Address; actualChainId: number; expectedChainId: number; status: "wrong-network" }
  | { account: Address; blockNumber: bigint; chainId: number; error: Error; status: "rpc-error" }
  | { position: WalletPoolPosition; status: "zero-balance" | "ready" };

export type WalletPoolPositionInput = {
  client?: PoolPositionClient;
  connection: PoolPositionConnection;
  pool: Pool;
  poolState: PoolState;
  requestedAccount?: Address;
};

export class PoolPositionContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PoolPositionContextError";
  }
}

function contextError(message: string): never {
  throw new PoolPositionContextError(message);
}

function validateReadContext(input: WalletPoolPositionInput): {
  account: Address;
  blockNumber: bigint;
  client: PoolPositionClient;
} {
  const { client, connection, pool, poolState, requestedAccount } = input;
  if (connection.status !== "connected") contextError("A connected wallet is required");
  if (!requestedAccount || !isAddressEqual(requestedAccount, connection.account)) {
    contextError("The requested account does not match the connected wallet");
  }
  if (!client) contextError("A public client is required for the connected wallet");
  if (poolState.poolId !== pool.id
    || poolState.chainId !== pool.chain.id
    || !isAddressEqual(poolState.poolAddress, pool.contract.address)) {
    contextError("The pool-state snapshot does not match the requested pool");
  }
  if (client.chain?.id !== pool.chain.id) {
    contextError("The public client chain does not match the requested pool");
  }
  return { account: requestedAccount, blockNumber: BigInt(poolState.blockNumber), client };
}

function asBigint(value: unknown, label: string): bigint {
  if (typeof value !== "bigint") throw new Error(`RPC returned an invalid ${label}`);
  return value;
}

function asLockedDeposit(value: unknown): readonly [bigint, bigint] {
  if (!Array.isArray(value)) throw new Error("RPC returned an invalid locked deposit");
  const candidate: unknown[] = value;
  const lockedUntil = candidate[0];
  const locked = candidate[1];
  if (candidate.length !== 2 || typeof lockedUntil !== "bigint" || typeof locked !== "bigint") {
    throw new Error("RPC returned an invalid locked deposit");
  }
  return [lockedUntil, locked];
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`RPC returned an invalid ${label}`);
  return value;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Pool-position RPC reads failed", { cause: error });
}

export function createPoolPositionContracts(pool: Pool, account: Address) {
  return [
    ...pool.assets.map((asset) => ({
      abi: erc20Abi,
      address: asset.address,
      args: [account],
      functionName: "balanceOf" as const,
    })),
    { abi: erc20Abi, address: pool.lpToken.address, args: [account], functionName: "balanceOf" as const },
    { abi: setwisePoolAbi, address: pool.contract.address, args: [account], functionName: "lockedDeposits" as const },
    { abi: setwisePoolAbi, address: pool.contract.address, args: [account], functionName: "canClaimShares" as const },
  ] as const;
}

export function decodeWalletPoolPosition(input: {
  account: Address;
  nativeBalance: bigint;
  pool: Pool;
  poolState: PoolState;
  results: readonly unknown[];
}): WalletPoolPosition {
  const { account, nativeBalance, pool, poolState, results } = input;
  const expectedResults = pool.assets.length + 3;
  if (results.length !== expectedResults) {
    throw new Error(`RPC returned ${results.length} results for ${expectedResults} Set reads`);
  }
  const assetBalances = pool.assets.map((asset, index): WalletAssetBalance => ({
    address: asset.address,
    assetId: asset.id,
    balance: asBigint(results[index], `${asset.id} wallet balance`),
  }));
  const unlocked = asBigint(results[pool.assets.length], "unlocked share balance");
  const [lockedUntil, locked] = asLockedDeposit(results[pool.assets.length + 1]);
  const canClaim = asBoolean(results[pool.assets.length + 2], "claim eligibility");
  return {
    account,
    assetBalances,
    blockNumber: BigInt(poolState.blockNumber),
    chainId: pool.chain.id,
    nativeBalance,
    shares: {
      canClaim,
      locked,
      lockedUntil,
      totalAttributed: unlocked + locked,
      unlocked,
    },
  };
}

export function isWalletPoolPositionZero(position: WalletPoolPosition): boolean {
  return position.nativeBalance === 0n
    && position.assetBalances.every((asset) => asset.balance === 0n)
    && position.shares.totalAttributed === 0n;
}

export function walletPoolPositionQueryKey(input: Pick<
  WalletPoolPositionInput,
  "connection" | "pool" | "poolState" | "requestedAccount"
>) {
  const { connection, pool, poolState, requestedAccount } = input;
  return [
    "wallet-pool-position",
    pool.id,
    pool.contract.address.toLowerCase(),
    poolState.blockNumber,
    connection.status === "connected" ? connection.chainId : null,
    requestedAccount?.toLowerCase() ?? null,
  ] as const;
}

export async function readWalletPoolPosition(
  input: WalletPoolPositionInput,
): Promise<WalletPoolPositionState> {
  const { connection, pool } = input;
  if (connection.status === "disconnected") return { status: "disconnected" };
  if (!input.requestedAccount || !isAddressEqual(input.requestedAccount, connection.account)) {
    contextError("The requested account does not match the connected wallet");
  }
  if (connection.chainId !== pool.chain.id) {
    return {
      account: connection.account,
      actualChainId: connection.chainId,
      expectedChainId: pool.chain.id,
      status: "wrong-network",
    };
  }

  const { account, blockNumber, client } = validateReadContext(input);
  const contracts = createPoolPositionContracts(pool, account);

  try {
    const [results, nativeBalance] = await Promise.all([
      client.multicall({ allowFailure: false, blockNumber, contracts }),
      client.getBalance({ address: account, blockNumber }),
    ]);
    const position = decodeWalletPoolPosition({
      account,
      nativeBalance,
      pool,
      poolState: input.poolState,
      results,
    });
    return { position, status: isWalletPoolPositionZero(position) ? "zero-balance" : "ready" };
  } catch (error) {
    return {
      account,
      blockNumber,
      chainId: pool.chain.id,
      error: toError(error),
      status: "rpc-error",
    };
  }
}
