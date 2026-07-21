import { render, screen, within } from "@testing-library/react";

import type { Pool, PoolState } from "../../data/rfq/deposits";
import { PoolOverviewPage, type PoolOverviewPageProps } from "./PoolOverviewPage";

const poolAddress = "0x1111111111111111111111111111111111111111";

const pool = {
  id: "pool",
  chain: { id: 97, name: "BSC Testnet" },
  contract: { address: poolAddress },
  lpToken: { address: poolAddress, decimals: 18, symbol: "SET" },
  quotePolicy: { allowedLockDays: [0] },
  assets: [
    { id: "USDT", index: 0, name: "Mock Tether", symbol: "USDT", address: "0x2222222222222222222222222222222222222222", decimals: 6, weight: 35 },
    { id: "STOCK", index: 1, name: "Mock Stock", symbol: "STOCK", address: "0x3333333333333333333333333333333333333333", decimals: 18, weight: 65 },
  ],
};

const state = {
  poolId: "pool",
  chainId: 97,
  poolAddress,
  blockNumber: "120266420",
  blockTimestamp: "2026-07-20T16:30:31.000Z",
  trading: { paused: false, deposits: "available" },
  totalValueUsd: "1000.01",
  totalSupply: { amount: "400.004", atomicAmount: "400004000000000000000", decimals: 18 },
  assets: [
    { asset: "STOCK", amount: "6", atomicAmount: "6000000000000000000", decimals: 18, index: 1, recordedAtomicBalance: "6000000000000000000", actualAtomicBalance: "6000000000000000000", balanceStatus: "synced", multiplier: "1", valueUsd: "600.006", market: { bidUsd: "99.99", askUsd: "100.01", observedAt: "2026-07-20T16:30:34.251Z" } },
    { asset: "USDT", amount: "400", atomicAmount: "400000000", decimals: 6, index: 0, recordedAtomicBalance: "400000000", actualAtomicBalance: "400000000", balanceStatus: "synced", multiplier: "1", valueUsd: "400.004", market: { bidUsd: "1.0001", askUsd: "1.0003", observedAt: "2026-07-20T16:30:34.251Z" } },
  ],
};

const defaultProps: PoolOverviewPageProps = {
  error: null,
  loading: false,
  onRetry: vi.fn(),
  online: true,
  pool: pool as Pool,
  refreshing: false,
  state: state as PoolState,
};

function renderOverview(overrides: Partial<PoolOverviewPageProps> = {}) {
  return render(<PoolOverviewPage {...defaultProps} {...overrides} />);
}

describe("PoolOverviewPage", () => {
  it("renders wallet-free headline metrics, timestamp, and contract-ordered reserve rows", () => {
    renderOverview();

    expect(screen.getByText("$1000.01")).toBeInTheDocument();
    expect(screen.getByText("400.004")).toBeInTheDocument();
    expect(screen.getByText("$2.5000 USD")).toBeInTheDocument();
    expect(screen.getByText(/20 Jul 2026, 16:30:31 UTC/)).toBeInTheDocument();
    expect(screen.getByText(/Block 120266420/)).toBeInTheDocument();
    expect(screen.getByText("$1.0002")).toBeInTheDocument();
    expect(screen.getByText("+5.00 pp")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Set liquidity details" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("Set liquidity, allocations, and reserve health")).toBeInTheDocument();

    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("Mock Tether")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Mock Stock")).toBeInTheDocument();
  });

  it("shows a visible warning for drifted balances while retaining the server usable balance", () => {
    const driftedState = {
      ...state,
      assets: state.assets.map((assetState) => assetState.asset === "USDT"
        ? { ...assetState, actualAtomicBalance: "500000000", balanceStatus: "drifted" }
        : assetState),
    } as PoolState;
    renderOverview({ state: driftedState });

    expect(screen.getByRole("alert")).toHaveTextContent(/Reserve balance drift detected/);
    expect(screen.getByText("Drifted")).toBeInTheDocument();
    expect(screen.getByText("400 USDT")).toBeInTheDocument();
    expect(screen.queryByText("500000000")).not.toBeInTheDocument();
  });

  it("defines loading, empty, stale, and API-error states", () => {
    const { rerender } = render(<PoolOverviewPage {...defaultProps} loading pool={undefined} state={undefined} />);
    expect(screen.getByText(/Loading public pool overview/)).toBeInTheDocument();

    rerender(<PoolOverviewPage {...defaultProps} error={new Error("Pool API unavailable")} pool={undefined} state={undefined} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Pool API unavailable");

    rerender(<PoolOverviewPage {...defaultProps} refreshing />);
    expect(screen.getByRole("status")).toHaveTextContent(/Refreshing live pool data/);

    rerender(<PoolOverviewPage {...defaultProps} online={false} pool={undefined} state={undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent("No saved Set snapshot is available offline");
  });

  it("shows unavailable derived values and preserves long asset labels without numeric coercion", () => {
    const unavailableState = {
      ...state,
      totalValueUsd: "0",
      totalSupply: { ...state.totalSupply, amount: "0", atomicAmount: "0" },
      assets: state.assets.map((assetState) => ({ ...assetState, valueUsd: "0" })),
    } as PoolState;
    const longSymbolPool = {
      ...pool,
      assets: pool.assets.map((asset) => asset.id === "USDT"
        ? { ...asset, name: "Long-form reserve asset", symbol: "VERY-LONG-RESERVE-SYMBOL" }
        : asset),
    } as Pool;
    renderOverview({ pool: longSymbolPool, state: unavailableState });

    expect(screen.getAllByText("Unavailable")).toHaveLength(5);
    expect(screen.getByText("VERY-LONG-RESERVE-SYMBOL")).toBeVisible();
  });
});
