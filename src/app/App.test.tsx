import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { MemoryRouter } from "react-router-dom";

import { App } from "./App";
import { runtimeConfig } from "../config/env";
import type { Pool, PoolState } from "../data/rfq/deposits";
import type { PoolSummary } from "../data/rfq/pools";
import type { PoolPageProps } from "../features/pool-analytics/PoolPage";

const poolAddress = "0x1111111111111111111111111111111111111111";
const lpAddress = "0x2222222222222222222222222222222222222222";
const tokenAddress = "0x3333333333333333333333333333333333333333";

function summary(id: string, chainId = 97): PoolSummary {
  return {
    id,
    display: { name: `Set ${id}`, description: `Description for ${id}`, sortOrder: 0, category: "Index" },
    chain: { id: chainId, name: chainId === 97 ? "BSC Testnet" : "Ethereum" },
    contract: { address: poolAddress },
    lpToken: { symbol: "SETWISE", decimals: 18, address: lpAddress },
    assets: [
      { id: "USDT", symbol: "mUSDT", address: tokenAddress, decimals: 6, weight: 100, index: 0 },
    ],
  };
}

function detail(id: string, chainId = 97): Pool {
  return {
    ...summary(id, chainId),
    quotePolicy: { allowedLockDays: [0] },
  };
}

function state(id: string, chainId = 97): PoolState {
  return {
    poolId: id,
    chainId,
    poolAddress,
    blockNumber: id === "second-set" ? "202" : "101",
    blockTimestamp: id === "second-set" ? "2026-07-21T13:00:00.000Z" : "2026-07-21T12:00:00.000Z",
    trading: { paused: false, deposits: "available" },
    totalValueUsd: id === "second-set" ? "2000" : "1000",
    totalSupply: { amount: "100", atomicAmount: "100000000000000000000", decimals: 18 },
    assets: [{
      asset: "USDT",
      amount: "1000",
      atomicAmount: "1000000000",
      decimals: 6,
      index: 0,
      recordedAtomicBalance: "1000000000",
      actualAtomicBalance: "1000000000",
      balanceStatus: "synced",
      multiplier: "1",
      valueUsd: id === "second-set" ? "2000" : "1000",
      market: { bidUsd: "1", askUsd: "1", observedAt: "2026-07-21T12:00:00.000Z" },
    }],
  };
}

const mocks = vi.hoisted(() => ({
  getPool: vi.fn(),
  getPools: vi.fn(),
  getPoolState: vi.fn(),
}));

vi.mock("../data/rfq/pools", () => ({
  getPools: mocks.getPools,
}));
vi.mock("../data/rfq/deposits", () => ({
  getPool: mocks.getPool,
  getPoolState: mocks.getPoolState,
}));

vi.mock("../features/pool-analytics/PoolPage", () => ({
  POOL_STATE_REFRESH_INTERVAL_MS: 15_000,
  PoolPage: ({ error, pool, poolState, showWalletPosition }: PoolPageProps) => (
    <section aria-label="Set analytics integration">
      {error ? `Analytics error: ${error.message}` : `${pool?.id ?? "no-pool"}: ${poolState?.totalValueUsd ?? "no-state"}`}
      {showWalletPosition ? " · wallet enabled" : " · wallet disabled"}
    </section>
  ),
}));
vi.mock("../features/deposit/DepositPage", () => ({
  DepositPage: () => <section aria-label="Deposit integration">Deposit form</section>,
}));
vi.mock("../features/withdraw/WithdrawPage", () => ({
  WithdrawPage: () => <section aria-label="Withdraw integration">Withdraw form</section>,
}));
vi.mock("../features/swap/SwapPage", () => ({
  SwapPage: () => <section aria-label="Swap integration">Swap form</section>,
}));
vi.mock("../features/faucet/FaucetPage", () => ({
  FaucetPage: () => <section aria-label="Faucet integration">Faucet form</section>,
}));
vi.mock("../features/wallet/WalletGate", () => ({
  WalletGate: ({ children }: PropsWithChildren) => <>{children}</>,
}));
vi.mock("../features/wallet/NetworkBanner", () => ({ NetworkBanner: () => null }));
vi.mock("../features/wallet/WalletButton", () => ({ WalletButton: () => null }));
vi.mock("../features/pwa/PwaStatus", () => ({ PwaStatus: () => null }));

function renderApp(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Sets routes and navigation", () => {
  beforeEach(() => {
    mocks.getPool.mockReset();
    mocks.getPools.mockReset();
    mocks.getPoolState.mockReset();
    mocks.getPools.mockResolvedValue([
      summary(runtimeConfig.defaultPoolId),
      summary("second-set"),
      summary("eth-set", 1),
    ]);
    mocks.getPool.mockImplementation((id: string) => Promise.resolve(detail(id, id === "eth-set" ? 1 : 97)));
    mocks.getPoolState.mockImplementation((id: string) => Promise.resolve(state(id, id === "eth-set" ? 1 : 97)));
  });

  it("uses Sets terminology in primary navigation on desktop and mobile", () => {
    renderApp("/sets");
    const labels = ["Sets", "Portfolio", "Swap", "Activity"];
    for (const label of labels) {
      expect(screen.getAllByRole("link", { name: label })).toHaveLength(2);
    }
    expect(screen.queryByRole("link", { name: "Pool" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Deposit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Withdraw" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Sets" })[0]).toHaveAttribute("href", "/sets");
    expect(screen.getAllByRole("link", { name: "Portfolio" })[0]).toHaveAttribute("href", "/portfolio");
  });

  it("marks Sets active on nested Set routes", async () => {
    renderApp(`/sets/${runtimeConfig.defaultPoolId}/overview`);
    await screen.findByRole("heading", { name: `Set ${runtimeConfig.defaultPoolId}` });
    expect(screen.getAllByRole("link", { name: "Sets" })[0]).toHaveClass("is-active");
  });

  it("loads /sets as the default landing content", async () => {
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Sets" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: runtimeConfig.defaultPoolId })).toBeVisible();
  });

  it("redirects /sets/:setId to the overview tab", async () => {
    renderApp(`/sets/${runtimeConfig.defaultPoolId}`);
    expect(await screen.findByRole("heading", { name: "Set overview" })).toBeVisible();
    expect(screen.getByLabelText("Set analytics integration")).toBeVisible();
  });

  it("keeps route-driven Set tabs deep-linkable", async () => {
    renderApp(`/sets/${runtimeConfig.defaultPoolId}/overview`);
    await screen.findByRole("heading", { name: "Set overview" });

    const tabs = screen.getByRole("navigation", { name: "Set sections" });
    const overviewTab = within(tabs).getByRole("link", { name: "Overview" });
    const depositTab = within(tabs).getByRole("link", { name: "Deposit" });
    expect(overviewTab).toHaveAttribute("aria-current", "page");
    depositTab.focus();
    expect(depositTab).toHaveFocus();
    fireEvent.click(depositTab);
    expect(await screen.findByRole("heading", { name: "Deposit into this Set" })).toBeVisible();
    expect(screen.getByLabelText("Deposit integration")).toBeVisible();
    expect(depositTab).toHaveAttribute("aria-current", "page");

    fireEvent.click(within(tabs).getByRole("link", { name: "Withdraw" }));
    expect(await screen.findByRole("heading", { name: "Withdraw from this Set" })).toBeVisible();
  });

  it("renders the Set presentation header, explorer link, constituents, and responsive metadata structure", async () => {
    const { container } = renderApp(`/sets/${runtimeConfig.defaultPoolId}/overview`);

    expect(await screen.findByRole("heading", { name: `Set ${runtimeConfig.defaultPoolId}` })).toBeVisible();
    expect(screen.getByText(`Description for ${runtimeConfig.defaultPoolId}`)).toBeVisible();
    expect(screen.getAllByText("BSC Testnet")).toHaveLength(2);
    expect(screen.getByText("mUSDT")).toBeVisible();
    expect(screen.getByText("100%")).toBeVisible();
    expect(screen.getByRole("link", { name: /View Set contract/ })).toHaveAttribute(
      "href",
      `${runtimeConfig.explorerUrl}/address/${poolAddress}`,
    );
    expect(container.querySelector(".set-detail-metadata")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Set sections" })).toBeVisible();
  });

  it("keeps two Set URLs isolated across definitions and live snapshots", async () => {
    const first = renderApp(`/sets/${runtimeConfig.defaultPoolId}/overview`);
    expect(await screen.findByRole("heading", { name: `Set ${runtimeConfig.defaultPoolId}` })).toBeVisible();
    expect(await screen.findByLabelText("Set analytics integration")).toHaveTextContent(
      `${runtimeConfig.defaultPoolId}: 1000`,
    );
    first.unmount();

    renderApp("/sets/second-set/overview");
    expect(await screen.findByRole("heading", { name: "Set second-set" })).toBeVisible();
    expect(await screen.findByLabelText("Set analytics integration")).toHaveTextContent("second-set: 2000");
    expect(screen.queryByText(`${runtimeConfig.defaultPoolId}: 1000`)).not.toBeInTheDocument();
  });

  it("keeps public overview data visible but disables wallet and operations on unsupported chains", async () => {
    renderApp("/sets/eth-set/overview");

    expect(await screen.findByRole("heading", { name: "Set eth-set" })).toBeVisible();
    expect(await screen.findByLabelText("Set analytics integration")).toHaveTextContent("eth-set: 1000 · wallet disabled");
    expect(screen.getByText(/Public Set data remains visible/)).toBeVisible();
    expect(screen.queryByRole("link", { name: /View Set contract/ })).not.toBeInTheDocument();
  });

  it("shows paused status and blocks transaction content while preserving the overview", async () => {
    mocks.getPoolState.mockImplementation((id: string) => Promise.resolve({
      ...state(id),
      trading: { paused: true, deposits: "paused" },
    }));
    renderApp(`/sets/${runtimeConfig.defaultPoolId}/deposit`);

    expect(await screen.findByText("Paused")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("This Set is paused");
    expect(screen.getByRole("heading", { name: "Deposits unavailable" })).toBeVisible();
    expect(screen.queryByLabelText("Deposit integration")).not.toBeInTheDocument();
  });

  it("retains Set identity during a partial state failure and offers a safe analytics error", async () => {
    mocks.getPoolState.mockRejectedValue(new Error("State endpoint unavailable"));
    renderApp(`/sets/${runtimeConfig.defaultPoolId}/overview`);

    expect(await screen.findByRole("heading", { name: `Set ${runtimeConfig.defaultPoolId}` })).toBeVisible();
    expect(await screen.findByLabelText("Set analytics integration")).toHaveTextContent("State endpoint unavailable");
    expect(screen.getByText("Awaiting live snapshot")).toBeVisible();
  });

  it("rejects a live snapshot belonging to another Set", async () => {
    mocks.getPoolState.mockResolvedValue(state("second-set"));
    renderApp(`/sets/${runtimeConfig.defaultPoolId}/overview`);

    expect(await screen.findByRole("alert")).toHaveTextContent("Set data mismatch");
    expect(screen.getByLabelText("Set analytics integration")).toHaveTextContent(
      "The Set detail or live state belongs to a different Set",
    );
    expect(screen.queryByText(/second-set: 2000/)).not.toBeInTheDocument();
  });

  it("redirects legacy /pool to the configured Set overview", async () => {
    renderApp("/pool");
    expect(await screen.findByRole("heading", { name: "Set overview" })).toBeVisible();
  });

  it("redirects legacy /deposit to the configured Set deposit tab", async () => {
    renderApp("/deposit");
    expect(await screen.findByRole("heading", { name: "Deposit into this Set" })).toBeVisible();
  });

  it("redirects legacy /withdraw to the configured Set withdraw tab", async () => {
    renderApp("/withdraw");
    expect(await screen.findByRole("heading", { name: "Withdraw from this Set" })).toBeVisible();
  });

  it("shows an unknown-Set state for registry misses", async () => {
    renderApp("/sets/does-not-exist/overview");
    expect(await screen.findByRole("heading", { name: "Unknown Set" })).toBeVisible();
    expect(screen.getByText(/does-not-exist/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Browse Sets" })).toHaveAttribute("href", "/sets");
  });

  it("avoids user-facing Pool nav copy while retaining precise liquidity-pool language", async () => {
    renderApp("/sets");
    expect(await screen.findByText(/underlying liquidity pool/i)).toBeVisible();
    expect(screen.queryByRole("heading", { name: /pool overview/i })).not.toBeInTheDocument();
  });

  it("loads portfolio and swap routes directly", () => {
    renderApp("/portfolio");
    expect(screen.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  });

  it("keeps swap Set-aware in copy and loadable", () => {
    renderApp("/swap");
    expect(screen.getByRole("heading", { name: "Swap assets" })).toBeVisible();
    expect(screen.getByText(/supported Set assets/i)).toBeVisible();
  });

  it("retains the testnet faucet utility route", () => {
    renderApp("/faucet");
    expect(screen.getByRole("heading", { name: "Get mock assets" })).toBeVisible();
  });
});
