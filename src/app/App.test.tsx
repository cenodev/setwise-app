import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { MemoryRouter } from "react-router-dom";

import { App } from "./App";
import { runtimeConfig } from "../config/env";
import type { PoolSummary } from "../data/rfq/pools";

const poolAddress = "0x1111111111111111111111111111111111111111";
const lpAddress = "0x2222222222222222222222222222222222222222";
const tokenAddress = "0x3333333333333333333333333333333333333333";

function summary(id: string, chainId = 97): PoolSummary {
  return {
    id,
    chain: { id: chainId, name: chainId === 97 ? "BSC Testnet" : "Ethereum" },
    contract: { address: poolAddress },
    lpToken: { symbol: "SETWISE", decimals: 18, address: lpAddress },
    assets: [
      { id: "USDT", symbol: "mUSDT", address: tokenAddress, decimals: 6, weight: 5000, index: 0 },
    ],
  };
}

const mocks = vi.hoisted(() => ({
  getPools: vi.fn(),
}));

vi.mock("../data/rfq/pools", () => ({
  getPools: mocks.getPools,
}));

vi.mock("../features/pool-analytics/PoolPage", () => ({
  PoolPage: () => <section aria-label="Set analytics integration">Integrated Set content</section>,
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
    mocks.getPools.mockReset();
    mocks.getPools.mockResolvedValue([
      summary(runtimeConfig.defaultPoolId),
      summary("second-set"),
      summary("eth-set", 1),
    ]);
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
    await screen.findByRole("heading", { name: runtimeConfig.defaultPoolId });
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
    fireEvent.click(within(tabs).getByRole("link", { name: "Deposit" }));
    expect(await screen.findByRole("heading", { name: "Deposit into this Set" })).toBeVisible();
    expect(screen.getByLabelText("Deposit integration")).toBeVisible();

    fireEvent.click(within(tabs).getByRole("link", { name: "Withdraw" }));
    expect(await screen.findByRole("heading", { name: "Withdraw from this Set" })).toBeVisible();
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
