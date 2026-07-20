import { render, screen } from "@testing-library/react";
import type { Address } from "viem";

import type { Pool, PoolState } from "../../data/rfq/deposits";
import type { WalletPoolPositionHookState } from "../wallet/useWalletPoolPosition";
import { POOL_STATE_REFRESH_INTERVAL_MS, PoolPage } from "./PoolPage";

type PoolPageMocks = {
  online: boolean;
  options: Array<Record<string, unknown>>;
  poolError: Error | null;
  poolFetching: boolean;
  poolPending: boolean;
  poolRefetch: ReturnType<typeof vi.fn>;
  stateError: Error | null;
  stateFetching: boolean;
  statePending: boolean;
  stateRefetch: ReturnType<typeof vi.fn>;
  switchChain: ReturnType<typeof vi.fn>;
  walletState: WalletPoolPositionHookState;
};

const mocks = vi.hoisted<PoolPageMocks>(() => ({
  online: true,
  options: [] as Array<Record<string, unknown>>,
  poolError: null as Error | null,
  poolFetching: false,
  poolPending: false,
  poolRefetch: vi.fn(),
  stateError: null as Error | null,
  stateFetching: false,
  statePending: false,
  stateRefetch: vi.fn(),
  switchChain: vi.fn(),
  walletState: { status: "disconnected" },
}));

const account = "0x0000000000000000000000000000000000000001" as Address;
const poolAddress = "0x1111111111111111111111111111111111111111" as Address;
const assetAddress = "0x2222222222222222222222222222222222222222" as Address;
const pool = {
  id: "pool",
  chain: { id: 97, name: "BSC Testnet" },
  contract: { address: poolAddress },
  lpToken: { address: poolAddress, decimals: 18, symbol: "SET" },
  quotePolicy: { allowedLockDays: [0] },
  assets: [
    { id: "USDT", index: 0, name: "Mock Tether", symbol: "USDT", address: assetAddress, decimals: 6, weight: 100 },
  ],
} as Pool;
const state = {
  poolId: "pool",
  chainId: 97,
  poolAddress,
  blockNumber: "120266420",
  blockTimestamp: "2026-07-20T16:30:31.000Z",
  trading: { paused: false, deposits: "available" },
  totalValueUsd: "1000",
  totalSupply: { amount: "100", atomicAmount: "100000000000000000000", decimals: 18 },
  assets: [
    { asset: "USDT", amount: "1000", atomicAmount: "1000000000", decimals: 6, index: 0, recordedAtomicBalance: "1000000000", actualAtomicBalance: "1000000000", balanceStatus: "synced", multiplier: "1", valueUsd: "1000", market: { bidUsd: "1", askUsd: "1", observedAt: "2026-07-20T16:30:34.251Z" } },
  ],
} as PoolState;

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: Record<string, unknown>) => {
    mocks.options.push(options);
    const key = options.queryKey as readonly unknown[];
    const isPool = key[0] === "pool";
    return {
      data: isPool ? pool : state,
      error: isPool ? mocks.poolError : mocks.stateError,
      isFetching: isPool ? mocks.poolFetching : mocks.stateFetching,
      isPending: isPool ? mocks.poolPending : mocks.statePending,
      refetch: isPool ? mocks.poolRefetch : mocks.stateRefetch,
    };
  },
}));
vi.mock("../wallet/useWalletPoolPosition", () => ({
  useWalletPoolPosition: () => ({ state: mocks.walletState }),
}));
vi.mock("@reown/appkit/react", () => ({ useAppKit: () => ({ open: vi.fn() }) }));
vi.mock("wagmi", () => ({ useSwitchChain: () => ({ isPending: false, switchChain: mocks.switchChain }) }));

describe("PoolPage", () => {
  beforeAll(() => {
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => mocks.online);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.online = true;
    mocks.options.length = 0;
    mocks.poolError = null;
    mocks.poolFetching = false;
    mocks.poolPending = false;
    mocks.stateError = null;
    mocks.stateFetching = false;
    mocks.statePending = false;
    mocks.walletState = { status: "disconnected" };
  });

  it("keeps public reserves visible while the wallet is disconnected", () => {
    render(<PoolPage />);

    expect(screen.getAllByText("$1000.00")[0]).toBeVisible();
    expect(screen.getByText("1000 USDT")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Connect to view your balances" })).toBeVisible();
    expect(screen.getByText(/External venue liquidity and executable prices may differ/)).toBeVisible();
  });

  it("changes only the user section for connected and wrong-network wallets", () => {
    mocks.walletState = {
      status: "ready",
      position: {
        account,
        assetBalances: [{ address: assetAddress, assetId: "USDT", balance: 25_000_000n }],
        blockNumber: 120266420n,
        chainId: 97,
        nativeBalance: 0n,
        shares: { canClaim: false, locked: 0n, lockedUntil: 0n, totalAttributed: 10n * 10n ** 18n, unlocked: 10n * 10n ** 18n },
      },
    };
    const { rerender } = render(<PoolPage />);
    expect(screen.getAllByText("$1000.00")[0]).toBeVisible();
    expect(screen.getByText("~$100.00")).toBeVisible();

    mocks.walletState = { account, actualChainId: 1, expectedChainId: 97, status: "wrong-network" };
    rerender(<PoolPage />);
    expect(screen.getAllByText("$1000.00")[0]).toBeVisible();
    expect(screen.getByRole("heading", { name: "Switch to BSC Testnet" })).toBeVisible();
  });

  it("retains cached public data through offline and partial wallet failures", () => {
    mocks.online = false;
    mocks.walletState = {
      account,
      blockNumber: 120266420n,
      chainId: 97,
      error: new Error("RPC unavailable"),
      status: "rpc-error",
    };
    render(<PoolPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Showing the most recently saved pool snapshot");
    expect(screen.getAllByText("$1000.00")[0]).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("RPC unavailable");
  });

  it("keeps a complete snapshot visible after a refresh failure and configures online refresh", () => {
    mocks.stateError = new Error("State refresh failed");
    render(<PoolPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Live refresh failed");
    expect(screen.getAllByText("$1000.00")[0]).toBeVisible();
    screen.getByRole("button", { name: "Retry refresh" }).click();
    expect(mocks.poolRefetch).toHaveBeenCalledOnce();
    expect(mocks.stateRefetch).toHaveBeenCalledOnce();

    const stateOptions = mocks.options.find((options) => (options.queryKey as readonly unknown[])[0] === "pool-state");
    expect(stateOptions).toMatchObject({
      refetchInterval: POOL_STATE_REFRESH_INTERVAL_MS,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      staleTime: POOL_STATE_REFRESH_INTERVAL_MS,
    });
  });
});
