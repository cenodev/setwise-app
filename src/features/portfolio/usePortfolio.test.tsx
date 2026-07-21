import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import type { Address } from "viem";

import type { PortfolioWalletPositionState } from "../../data/chain/portfolioPositions";
import type { PortfolioSetSnapshotState } from "../../data/portfolio";
import type { Pool, PoolState } from "../../data/rfq/deposits";
import type { PoolSummary } from "../../data/rfq/pools";
import type { SetDefinition } from "../../data/sets";
import { usePortfolio } from "./usePortfolio";

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  getPools: vi.fn(),
  loadSnapshots: vi.fn(),
  publicClient: vi.fn(),
  readWallet: vi.fn(),
  toSetDefinition: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: mocks.account,
  usePublicClient: mocks.publicClient,
}));

vi.mock("../../data/rfq/pools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/rfq/pools")>();
  return { ...actual, getPools: mocks.getPools };
});

vi.mock("../../data/sets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/sets")>();
  return { ...actual, toSetDefinition: mocks.toSetDefinition };
});

vi.mock("../../data/portfolio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/portfolio")>();
  return { ...actual, loadPortfolioSetSnapshots: mocks.loadSnapshots };
});

vi.mock("../../data/chain/portfolioPositions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/chain/portfolioPositions")>();
  return { ...actual, readPortfolioWalletPositions: mocks.readWallet };
});

const account = "0x0000000000000000000000000000000000000001" as Address;
const nextAccount = "0x0000000000000000000000000000000000000002" as Address;

function address(value: number): Address {
  return `0x${value.toString(16).padStart(40, "0")}`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const summary = {
  assets: [{ address: address(3), decimals: 6, id: "set-alpha-asset", index: 0, symbol: "USDT", weight: 100 }],
  chain: { id: 97, name: "BSC Testnet" },
  contract: { address: address(1) },
  id: "set-alpha",
  lpToken: { address: address(2), decimals: 6, symbol: "SET" },
} as PoolSummary;

const definition = {
  chainId: 97,
  chainName: "BSC Testnet",
  id: "set-alpha",
  pool: { assets: summary.assets, contract: summary.contract },
  supported: true,
} as unknown as SetDefinition;

const pool = { ...summary, quotePolicy: { allowedLockDays: [0] } } as Pool;

function snapshot(blockNumber: string): PortfolioSetSnapshotState {
  return {
    definition,
    pool,
    state: {
      blockNumber,
      blockTimestamp: new Date().toISOString(),
      chainId: 97,
      poolAddress: summary.contract.address,
      poolId: "set-alpha",
      totalSupply: { amount: "10", atomicAmount: "10000000", decimals: 6 },
      totalValueUsd: "100",
      trading: { paused: false, deposits: "available" },
    } as PoolState,
    status: "ready",
  };
}

function walletPosition(
  holder: Address,
  shares: { canClaim: boolean; locked: bigint; lockedUntil: bigint; totalAttributed: bigint; unlocked: bigint },
): PortfolioWalletPositionState {
  return {
    poolId: "set-alpha",
    position: {
      account: holder,
      assetBalances: [],
      blockNumber: 110n,
      chainId: 97,
      nativeBalance: 0n,
      shares,
    },
    status: shares.totalAttributed === 0n ? "zero-balance" : "ready",
  };
}

const zeroShares = { canClaim: false, locked: 0n, lockedUntil: 0n, totalAttributed: 0n, unlocked: 0n };
const someShares = { canClaim: false, locked: 2_000_000n, lockedUntil: 0n, totalAttributed: 5_000_000n, unlocked: 3_000_000n };

function wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("usePortfolio", () => {
  let reads: ReturnType<typeof deferred<PortfolioWalletPositionState[]>>[];

  beforeEach(() => {
    vi.clearAllMocks();
    reads = [];
    mocks.account.mockReturnValue({ address: account, chainId: 97, isConnected: true });
    mocks.publicClient.mockReturnValue({ chain: { id: 97 } });
    mocks.getPools.mockResolvedValue([summary]);
    mocks.toSetDefinition.mockReturnValue(definition);
    mocks.readWallet.mockImplementation(() => {
      const read = deferred<PortfolioWalletPositionState[]>();
      reads.push(read);
      return read.promise;
    });
  });

  function resolveAllReads(positions: PortfolioWalletPositionState[]) {
    for (const read of reads) read.resolve(positions);
  }

  it("keeps confirmed positions visible while a snapshot refresh reloads wallet data", async () => {
    mocks.loadSnapshots
      .mockResolvedValueOnce([snapshot("100")])
      .mockResolvedValueOnce([snapshot("101")])
      .mockResolvedValue([snapshot("101")]);

    const { result } = renderHook(() => usePortfolio(), { wrapper });

    await waitFor(() => expect(reads.length).toBeGreaterThan(0));
    resolveAllReads([walletPosition(account, zeroShares)]);
    await waitFor(() => expect(result.current.view?.sets[0]?.wallet?.status).toBe("zero-balance"));

    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.view?.sets[0]?.snapshot).toMatchObject({
      state: { blockNumber: "101" },
      status: "ready",
    }));

    expect(result.current.view?.sets[0]?.wallet).toMatchObject({
      position: { shares: { totalAttributed: 0n } },
      status: "zero-balance",
    });
    expect(result.current.view?.walletLoading).toBe(false);

    resolveAllReads([walletPosition(account, someShares)]);
    await waitFor(() => expect(result.current.view?.sets[0]?.wallet?.status).toBe("ready"));
    expect(result.current.view?.sets[0]?.wallet).toMatchObject({
      position: { shares: { totalAttributed: 5_000_000n } },
    });
  });

  it("drops retained wallet data when the account changes", async () => {
    mocks.loadSnapshots.mockResolvedValue([snapshot("100")]);
    let connection = { address: account, chainId: 97, isConnected: true };
    mocks.account.mockImplementation(() => connection);

    const { rerender, result } = renderHook(() => usePortfolio(), { wrapper });

    await waitFor(() => expect(reads.length).toBeGreaterThan(0));
    resolveAllReads([walletPosition(account, someShares)]);
    await waitFor(() => expect(result.current.view?.sets[0]?.wallet?.status).toBe("ready"));

    connection = { address: nextAccount, chainId: 97, isConnected: true };
    rerender();

    expect(result.current.view?.walletLoading).toBe(true);
    expect(result.current.view?.sets[0]?.wallet?.status).toBe("error");

    resolveAllReads([walletPosition(nextAccount, someShares)]);
    await waitFor(() => expect(result.current.view?.sets[0]?.wallet?.status).toBe("ready"));
    expect(result.current.view?.sets[0]?.wallet).toMatchObject({ position: { account: nextAccount } });
  });
});
