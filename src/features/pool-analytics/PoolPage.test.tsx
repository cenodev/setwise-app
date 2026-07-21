import { render, screen } from "@testing-library/react";
import type { Address } from "viem";

import type { Pool, PoolState } from "../../data/rfq/deposits";
import type { WalletPoolPositionHookState } from "../wallet/useWalletPoolPosition";
import { PoolPage, type PoolPageProps } from "./PoolPage";

const mocks = vi.hoisted<{
  online: boolean;
  switchChain: ReturnType<typeof vi.fn>;
  walletState: WalletPoolPositionHookState;
}>(() => ({
  online: true,
  switchChain: vi.fn(),
  walletState: { status: "disconnected" },
}));

const account = "0x0000000000000000000000000000000000000001" as Address;
const poolAddress = "0x1111111111111111111111111111111111111111" as Address;
const assetAddress = "0x2222222222222222222222222222222222222222" as Address;
const pool = {
  id: "pool",
  display: { name: "Test Set", description: "A test Set", sortOrder: 0 },
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

vi.mock("../wallet/useWalletPoolPosition", () => ({
  useWalletPoolPosition: () => ({ state: mocks.walletState }),
}));
vi.mock("@reown/appkit/react", () => ({ useAppKit: () => ({ open: vi.fn() }) }));
vi.mock("wagmi", () => ({ useSwitchChain: () => ({ isPending: false, switchChain: mocks.switchChain }) }));

const defaultProps: PoolPageProps = {
  error: null,
  loading: false,
  onRetry: vi.fn(),
  pool,
  poolState: state,
  refreshing: false,
  showWalletPosition: true,
};

describe("PoolPage", () => {
  beforeAll(() => {
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => mocks.online);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.online = true;
    mocks.walletState = { status: "disconnected" };
  });

  it("keeps public reserves visible while the wallet is disconnected", () => {
    render(<PoolPage {...defaultProps} />);

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
    const { rerender } = render(<PoolPage {...defaultProps} />);
    expect(screen.getAllByText("$1000.00")[0]).toBeVisible();
    expect(screen.getByText("~$100.00")).toBeVisible();

    mocks.walletState = { account, actualChainId: 1, expectedChainId: 97, status: "wrong-network" };
    rerender(<PoolPage {...defaultProps} />);
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
    render(<PoolPage {...defaultProps} />);

    expect(screen.getByRole("status")).toHaveTextContent("Showing the most recently saved Set snapshot");
    expect(screen.getAllByText("$1000.00")[0]).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("RPC unavailable");
  });

  it("keeps a complete snapshot visible after a refresh failure and retries both shared queries", () => {
    const retry = vi.fn();
    render(<PoolPage {...defaultProps} error={new Error("State refresh failed")} onRetry={retry} />);

    expect(screen.getByRole("status")).toHaveTextContent("Live refresh failed");
    expect(screen.getAllByText("$1000.00")[0]).toBeVisible();
    screen.getByRole("button", { name: "Retry refresh" }).click();
    expect(retry).toHaveBeenCalledOnce();
  });

  it("keeps public data visible while wallet reads are disabled for an unsupported chain", () => {
    render(<PoolPage {...defaultProps} showWalletPosition={false} />);

    expect(screen.getAllByText("$1000.00")[0]).toBeVisible();
    expect(screen.getByRole("heading", { name: "Wallet position unavailable on this chain" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Connect to view your balances" })).not.toBeInTheDocument();
  });
});
