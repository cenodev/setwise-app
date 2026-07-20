import { render, screen, within } from "@testing-library/react";

import { PoolOverviewPage } from "./PoolOverviewPage";

const mocks = vi.hoisted(() => ({
  pool: undefined as Record<string, unknown> | undefined,
  poolError: null as Error | null,
  poolFetching: false,
  poolPending: false,
  state: undefined as Record<string, unknown> | undefined,
  stateError: null as Error | null,
  stateFetching: false,
  statePending: false,
}));

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

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) => {
    const isPool = options.queryKey[0] === "pool";
    return {
      data: isPool ? mocks.pool : mocks.state,
      error: isPool ? mocks.poolError : mocks.stateError,
      isFetching: isPool ? mocks.poolFetching : mocks.stateFetching,
      isPending: isPool ? mocks.poolPending : mocks.statePending,
      refetch: vi.fn(),
    };
  },
}));

function renderReady() {
  mocks.pool = pool;
  mocks.state = state;
  render(<PoolOverviewPage />);
}

describe("PoolOverviewPage", () => {
  beforeEach(() => {
    mocks.pool = undefined;
    mocks.state = undefined;
    mocks.poolError = null;
    mocks.stateError = null;
    mocks.poolFetching = false;
    mocks.stateFetching = false;
    mocks.poolPending = false;
    mocks.statePending = false;
  });

  it("renders wallet-free headline metrics, timestamp, and contract-ordered reserve rows", () => {
    renderReady();

    expect(screen.getByText("$1000.01")).toBeInTheDocument();
    expect(screen.getByText("400.004")).toBeInTheDocument();
    expect(screen.getByText("$2.5000 USD")).toBeInTheDocument();
    expect(screen.getByText(/20 Jul 2026, 16:30:31 UTC/)).toBeInTheDocument();
    expect(screen.getByText(/Block 120266420/)).toBeInTheDocument();
    expect(screen.getByText("$1.0002")).toBeInTheDocument();
    expect(screen.getByText("+5.00 pp")).toBeInTheDocument();

    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("Mock Tether")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Mock Stock")).toBeInTheDocument();
  });

  it("shows a visible warning for drifted balances while retaining the server usable balance", () => {
    state.assets[1] = { ...state.assets[1], actualAtomicBalance: "500000000", balanceStatus: "drifted" };
    renderReady();

    expect(screen.getByRole("alert")).toHaveTextContent(/Reserve balance drift detected/);
    expect(screen.getByText("Drifted")).toBeInTheDocument();
    expect(screen.getByText("400 USDT")).toBeInTheDocument();
    expect(screen.queryByText("500000000")).not.toBeInTheDocument();
  });

  it("defines loading, empty, stale, and API-error states", () => {
    mocks.poolPending = true;
    mocks.statePending = true;
    const { rerender } = render(<PoolOverviewPage />);
    expect(screen.getByText(/Loading public pool overview/)).toBeInTheDocument();

    mocks.poolPending = false;
    mocks.statePending = false;
    rerender(<PoolOverviewPage />);
    expect(screen.getByText(/No public pool data yet/)).toBeInTheDocument();

    mocks.pool = pool;
    mocks.state = state;
    mocks.poolFetching = true;
    rerender(<PoolOverviewPage />);
    expect(screen.getByRole("status")).toHaveTextContent(/Refreshing live pool data/);

    mocks.poolFetching = false;
    mocks.poolError = new Error("Pool API unavailable");
    rerender(<PoolOverviewPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Pool API unavailable");
  });
});
