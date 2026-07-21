import type { Address } from "viem";

import type { WalletPoolPosition } from "../data/chain/poolPosition";
import type { Pool, PoolState } from "../data/rfq/deposits";
import type { PoolSummary } from "../data/rfq/pools";
import { toSetDefinition, type SetDefinition } from "../data/sets";

const account = "0x00000000000000000000000000000000000000A1" as Address;
const observedAt = "2026-07-21T12:00:00.000Z";

export type MultiSetFixture = Readonly<{
  definition: SetDefinition;
  pool: Pool;
  state: PoolState;
  summary: PoolSummary;
  wallet: WalletPoolPosition;
}>;

function fixture(input: Readonly<{
  assets: Pool["assets"];
  blockNumber: string;
  contract: Address;
  display: Pool["display"];
  externalLiquiditySources: NonNullable<PoolState["externalLiquiditySources"]>;
  id: string;
  lockDays: number[];
  lpDecimals: number;
  lpToken: Address;
  paused: boolean;
  totalSupplyAtomic: string;
  totalValueUsd: string;
  walletLocked: bigint;
  walletUnlocked: bigint;
}>): MultiSetFixture {
  const summary = {
    id: input.id,
    display: input.display,
    chain: { id: 97, name: "BSC Testnet" },
    contract: { address: input.contract },
    lpToken: { address: input.lpToken, decimals: input.lpDecimals, symbol: `LP-${input.id}` },
    assets: input.assets,
  } as PoolSummary;
  const pool = {
    ...summary,
    quotePolicy: { allowedLockDays: input.lockDays },
  } as Pool;
  const state = {
    assets: input.assets.map((asset) => ({
      actualAtomicBalance: "1000000",
      amount: "1",
      asset: asset.id,
      atomicAmount: "1000000",
      balanceStatus: "synced" as const,
      decimals: asset.decimals,
      index: asset.index,
      market: { askUsd: "1", bidUsd: "1", observedAt },
      multiplier: "1",
      recordedAtomicBalance: "1000000",
      valueUsd: (Number(input.totalValueUsd) / input.assets.length).toString(),
    })),
    blockNumber: input.blockNumber,
    blockTimestamp: observedAt,
    chainId: 97,
    externalLiquiditySources: input.externalLiquiditySources,
    poolAddress: input.contract,
    poolId: input.id,
    totalSupply: {
      amount: "1000",
      atomicAmount: input.totalSupplyAtomic,
      decimals: input.lpDecimals,
    },
    totalValueUsd: input.totalValueUsd,
    trading: {
      deposits: input.paused ? "paused" as const : "available" as const,
      paused: input.paused,
      proportionalWithdrawals: "available" as const,
      singleAssetWithdrawals: input.paused ? "paused" as const : "available" as const,
      swaps: input.paused ? "paused" as const : "available" as const,
    },
  } as PoolState;
  return {
    definition: toSetDefinition(summary, 97),
    pool,
    state,
    summary,
    wallet: {
      account,
      assetBalances: input.assets.map((asset, index) => ({
        address: asset.address,
        assetId: asset.id,
        balance: BigInt(index + 1) * 1_000_000n,
      })),
      blockNumber: BigInt(input.blockNumber),
      chainId: 97,
      nativeBalance: 100_000_000_000_000_000n,
      shares: {
        canClaim: input.walletLocked === 0n,
        locked: input.walletLocked,
        lockedUntil: input.walletLocked === 0n ? 0n : 1_786_000_000n,
        totalAttributed: input.walletUnlocked + input.walletLocked,
        unlocked: input.walletUnlocked,
      },
    },
  };
}

export const MULTI_SET_FIXTURES: readonly MultiSetFixture[] = [
  fixture({
    assets: [
      { address: "0x1000000000000000000000000000000000000001", decimals: 6, id: "USDT", index: 0, symbol: "mUSDT", weight: 6000 },
      { address: "0x1000000000000000000000000000000000000002", decimals: 18, id: "SPCXB", index: 1, symbol: "SPCXB", weight: 4000 },
    ],
    blockNumber: "41000001",
    contract: "0x1000000000000000000000000000000000000010",
    display: { category: "AI", description: "Active AI basket with flexible locking.", name: "AI Leaders", sortOrder: 10 },
    externalLiquiditySources: [{
      chainId: 97,
      liquidityUsd: "250000",
      observedAt,
      sourceAddress: "0x1000000000000000000000000000000000000020",
      venue: "PancakeSwap",
    }],
    id: "ai-leaders-bsc-testnet",
    lockDays: [0, 30, 90],
    lpDecimals: 18,
    lpToken: "0x1000000000000000000000000000000000000011",
    paused: false,
    totalSupplyAtomic: "1000000000000000000000",
    totalValueUsd: "1000000",
    walletLocked: 25_000_000_000_000_000_000n,
    walletUnlocked: 75_000_000_000_000_000_000n,
  }),
  fixture({
    assets: [
      { address: "0x2000000000000000000000000000000000000001", decimals: 8, id: "WBTC", index: 0, symbol: "mWBTC", weight: 5000 },
      { address: "0x2000000000000000000000000000000000000002", decimals: 6, id: "USDC", index: 1, symbol: "mUSDC", weight: 5000 },
    ],
    blockNumber: "41000009",
    contract: "0x2000000000000000000000000000000000000010",
    display: { category: "Balanced", description: "Paused defensive basket with no lock option.", name: "Defensive Pair", sortOrder: 20 },
    externalLiquiditySources: [{
      chainId: 97,
      liquidityUsd: "90000",
      observedAt,
      sourceAddress: "0x2000000000000000000000000000000000000020",
      venue: "Uniswap",
    }],
    id: "defensive-pair-bsc-testnet",
    lockDays: [0],
    lpDecimals: 6,
    lpToken: "0x2000000000000000000000000000000000000011",
    paused: true,
    totalSupplyAtomic: "500000000",
    totalValueUsd: "500000",
    walletLocked: 0n,
    walletUnlocked: 12_500_000n,
  }),
];
